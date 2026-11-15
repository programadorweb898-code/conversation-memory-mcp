const { Pool } = require("pg");
const { getConfig } = require("./config");
const { getDatabaseUrl, getPgSslOptions } = require("./databaseConfig");

// Sin estos límites, una query contra un endpoint que acepta el TCP pero no
// responde queda pendiente para siempre: sin `connectionTimeoutMillis` el
// `pool.query()` no llega a resolver ni a rechazar. El keepalive cubre el otro
// caso, una conexión ya establecida cuyo peer se cierra sin FIN, que los
// keepalive del sistema por defecto no detectarían a tiempo.
const { connectTimeoutMs: CONNECT_TIMEOUT_MS, keepaliveDelayMs: KEEPALIVE_DELAY_MS } = getConfig().database;

// Tope de duración de cada statement. Hay dos mecanismos y el orden importa:
// `statement_timeout` (el que se le manda al servidor al iniciar cada transaccion) es el
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

// PgBouncer puede cambiar el backend después de cada transacción. El esquema
// y el timeout deben aplicarse con SET LOCAL dentro de la transacción que
// ejecuta el trabajo, incluso cuando pg-pool reutiliza el mismo client.
// Cuando vence `query_timeout`, pg no cancela nada en el servidor: rechaza local
// y saca la query de `_queryQueue` (pg/lib/client.js:678), así que la siguiente
// se escribe al cable mientras el servidor todavía corre la anterior y su
// resultado queda atribuido a la nueva (client.js:605). Esa conexión ya no es
// confiable, hay que destruirla en vez de devolverla al pool.
const CLIENT_QUERY_TIMEOUT = /Query read timeout/;

function poisonedByClientTimeout(err) {
  return CLIENT_QUERY_TIMEOUT.test(err.message || "");
}

// One round trip starts and configures the transaction. Values come from the
// validated runtime config; SQL with application data stays parameterized.
const TRANSACTION_START_SQL = [
  "BEGIN",
  ...(searchPath ? [`SET LOCAL search_path TO "${searchPath}", public`] : []),
  `SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`,
].join("; ");

function isTransientConnectionError(err) {
  return isIdleDisconnect(err) || String(err.code || "").startsWith("08") ||
    ["ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT"].includes(err.code);
}

async function runTransaction(work) {
  for (let attempt = 0; ; attempt += 1) {
    let workStarted = false;
    try {
      return await runTransactionAttempt((client) => {
        workStarted = true;
        return work(client);
      });
    } catch (err) {
      // Only acquisition/setup is safe to retry: no application SQL has run.
      if (attempt > 0 || workStarted || !isTransientConnectionError(err)) throw err;
    }
  }
}

async function runTransactionAttempt(work) {
  const client = await pool.connect();
  let transactionActive = false;
  let connectionError = null;
  // pg-pool removes its idle error listener when a client is checked out.
  // pg rejects the active query AND emits error, even between awaited queries.
  const onError = (err) => { connectionError ||= err; };
  client.on("error", onError);

  const query = async (...args) => {
    if (connectionError) throw connectionError;
    try {
      const result = await client.query(...args);
      if (connectionError) throw connectionError;
      return result;
    } catch (err) {
      if (poisonedByClientTimeout(err)) connectionError ||= err;
      throw err;
    }
  };

  try {
    transactionActive = true;
    await query(TRANSACTION_START_SQL);
    const result = await work({ query });
    await query("COMMIT");
    transactionActive = false;
    return result;
  } finally {
    if (transactionActive && !connectionError) {
      try {
        await query("ROLLBACK");
      } catch (err) {
        connectionError = err;
        console.error("Error haciendo ROLLBACK de la transaccion:", err.message);
      }
    }
    // Hand error handling back to pg-pool before removing our own listener.
    // A broken connection is destroyed; work is never automatically replayed.
    client.release(connectionError);
    client.removeListener("error", onError);
  }
}

async function runQuery(sql, params) {
  return runTransaction((client) => client.query(sql, params));
}

async function withTransaction(work) {
  return runTransaction((client) => work({
    query: client.query,
    runAsync: async (sql, params = []) => {
      const result = await client.query(sql, params);
      return { changes: result.rowCount };
    },
    getAsync: async (sql, params = []) => {
      const result = await client.query(sql, params);
      return result.rows[0];
    },
    allAsync: async (sql, params = []) => {
      const result = await client.query(sql, params);
      return result.rows;
    },
  }));
}

async function withAdvisoryLock(key, work) {
  return runTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [hashtext(`advisory:${key}`)]);
    return work(client);
  });
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

module.exports = { db, withAdvisoryLock, withTransaction };
