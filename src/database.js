const { Pool } = require("pg");
const { getConfig } = require("./config");
const dotenv = require("dotenv");
const { getDatabaseUrl, getPgSslOptions } = require("./databaseConfig");
dotenv.config();

// Sin estos límites, una query contra un endpoint que acepta el TCP pero no
// responde queda pendiente para siempre: sin `connectionTimeoutMillis` el
// `pool.query()` no llega a resolver ni a rechazar. El keepalive cubre el otro
// caso, una conexión ya establecida cuyo peer se cierra sin FIN, que los
// keepalive del sistema por defecto no detectarían a tiempo.
const { connectTimeoutMs: CONNECT_TIMEOUT_MS, keepaliveDelayMs: KEEPALIVE_DELAY_MS } = getConfig().database;

// Tope de duración de cada statement. Hay dos mecanismos y el orden importa:
// `statement_timeout` (el que se le manda al servidor en `acquire()`) es el
// primario, porque Postgres cancela la query él mismo y el client queda
// reutilizable. `query_timeout` (el de pg, en el cliente) es la red de seguridad
// para el socket muerto, donde el servidor no puede cancelar nada, y por eso va
// por encima del del servidor: siempre cancela primero el que puede hacerlo
// bien.
const CLIENT_QUERY_TIMEOUT_MARGIN_MS = 5000;
const STATEMENT_TIMEOUT_MS = getConfig().database.queryTimeoutMs;

const poolOptions = {
  connectionString: getDatabaseUrl(),
  connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  query_timeout: STATEMENT_TIMEOUT_MS + CLIENT_QUERY_TIMEOUT_MARGIN_MS,
  keepAlive: true,
  keepAliveInitialDelayMillis: KEEPALIVE_DELAY_MS,
};

const sslOptions = getPgSslOptions();
if (sslOptions) poolOptions.ssl = sslOptions;

const pool = new Pool(poolOptions);

// pg-pool solo emite 'error' cuando un client ocioso falla, y ya lo purga antes
// (pg-pool/index.js:62): el siguiente query abre una conexión nueva solo. No es
// un error que requiera acción, así que se informa como lo que es. Los fallos al
// conectar no pasan por acá: rechazan el acquire y los reporta quien llamó.
//
// Cuando el servidor manda un ErrorResponse de Postgres llega con code; cuando
// el socket muere sin respuesta (suspensión del compute, corte de red) llega sin
// code y solo con el mensaje, así que hay que mirar las dos señales.
const IDLE_DISCONNECT_CODES = new Set([
  "57P01", // admin_shutdown: el compute se suspendió o reinició
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
  "57P05", // idle_session_timeout
  "08006", // connection_failure
]);

const IDLE_DISCONNECT_MESSAGES = [
  /Connection terminated unexpectedly/i,
  /Connection terminated due to administrator command/i,
  /terminating connection due to administrator command/i,
  /the database system is (starting up|shutting down)/i,
];

function isIdleDisconnect(err) {
  if (IDLE_DISCONNECT_CODES.has(err.code)) return true;
  return IDLE_DISCONNECT_MESSAGES.some((pattern) => pattern.test(err.message || ""));
}

pool.on("error", (err) => {
  const code = err.code ? ` [${err.code}]` : "";
  if (isIdleDisconnect(err)) {
    console.warn(
      `Conexión ociosa cerrada por el servidor${code}: ${err.message}. ` +
      "El pool abre una nueva al próximo query.",
    );
    return;
  }
  console.error(`Error inesperado en una conexión ociosa${code}: ${err.message}`);
});



// Schema donde viven las tablas. Por defecto es `public`; se cambia para no
// tocar el schema de producción (los tests usan `cm_test`). `public` queda
// siempre en el path porque ahí viven los tipos de las extensiones (pgvector).
// No se puede pasar por el startup packet: el endpoint pooled de Neon lo rechaza.
const searchPath = getConfig().database.searchPath;

// Los `SET` van al adquirir la conexión, no en el evento "connect": pg-pool no
// espera al handler del evento, así que ahí el SET compite con la primera
// query y las escrituras terminaban yendo a `public`. pg-pool recicla el mismo
// objeto client, así que un WeakSet alcanza para no repetirlo por conexión.
const prepared = new WeakSet();

// Cuando vence `query_timeout`, pg no cancela nada en el servidor: rechaza local
// y saca la query de `_queryQueue` (pg/lib/client.js:678), así que la siguiente
// se escribe al cable mientras el servidor todavía corre la anterior y su
// resultado queda atribuido a la nueva (client.js:605). Esa conexión ya no es
// confiable, hay que destruirla en vez de devolverla al pool.
const CLIENT_QUERY_TIMEOUT = /Query read timeout/;

function poisonedByClientTimeout(err) {
  return CLIENT_QUERY_TIMEOUT.test(err.message || "");
}

async function acquire() {
  const client = await pool.connect();
  if (!prepared.has(client)) {
    try {
      if (searchPath) await client.query(`SET search_path TO ${searchPath}, public`);
      await client.query(`SET statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
      prepared.add(client);
    } catch (err) {
      client.release(err);
      throw err;
    }
  }
  return client;
}

async function runQuery(sql, params) {
  const client = await acquire();
  let poisoned = null;
  try {
    return await client.query(sql, params);
  } catch (err) {
    poisoned = poisonedByClientTimeout(err) ? err : null;
    throw err;
  } finally {
    client.release(poisoned);
  }
}

async function withAdvisoryLock(key, work) {
  const client = await acquire();
  const lockValue = hashtext(`advisory:${key}`);
  let transactionActive = false;
  let poisoned = null;
  try {
    await client.query("BEGIN");
    transactionActive = true;
    await client.query("SELECT pg_advisory_xact_lock($1)", [lockValue]);
    const result = await work(client);
    await client.query("COMMIT");
    transactionActive = false;
    return result;
  } catch (err) {
    poisoned = poisonedByClientTimeout(err) ? err : null;
    throw err;
  } finally {
    // Con la conexión envenenada el ROLLBACK iría detrás de la query abandonada
    // en el cable: su respuesta no es confiable y solo gastaría otro timeout.
    // Al destruir el client, el servidor deshace la transacción solo.
    if (transactionActive && !poisoned) {
      try {
        await client.query("ROLLBACK");
      } catch (err) {
        console.error("Error haciendo ROLLBACK del advisory lock:", err.message);
      }
    }
    client.release(poisoned);
  }
}

function hashtext(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

const db = {
  query: (sql, params) => runQuery(sql, params),
  runAsync: async (sql, params = []) => {
    const result = await runQuery(sql, params);
    return { changes: result.rowCount };
  },
  getAsync: async (sql, params = []) => {
    const result = await runQuery(sql, params);
    return result.rows[0];
  },
  allAsync: async (sql, params = []) => {
    const result = await runQuery(sql, params);
    return result.rows;
  },
  close: async () => {
    await pool.end();
  }
};

module.exports = { db, withAdvisoryLock };
