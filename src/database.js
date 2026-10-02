const { Pool } = require("pg");
const dotenv = require("dotenv");
dotenv.config();

const poolOptions = {
  connectionString: process.env.DATABASE_URL,
};

if (process.env.PGSSL_REJECT_UNAUTHORIZED === "false") {
  poolOptions.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolOptions);

pool.on("error", (err) => {
  console.error("Error inesperado en el pool de Postgres (conexión idle):", err.message);
});



// Schema donde viven las tablas. Por defecto es `public`; se cambia para no
// tocar el schema de producción (los tests usan `cm_test`). `public` queda
// siempre en el path porque ahí viven los tipos de las extensiones (pgvector).
// No se puede pasar por el startup packet: el endpoint pooled de Neon lo rechaza.
const searchPath = process.env.PG_SEARCH_PATH;
if (searchPath && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(searchPath)) {
  throw new Error(`PG_SEARCH_PATH inválido: "${searchPath}"`);
}

// El `SET` va al adquirir la conexión, no en el evento "connect": pg-pool no
// espera al handler del evento, así que ahí el SET compite con la primera
// query y las escrituras terminaban yendo a `public`. pg-pool recicla el mismo
// objeto client, así que un WeakSet alcanza para no repetirlo por conexión.
const prepared = new WeakSet();

async function acquire() {
  const client = await pool.connect();
  if (searchPath && !prepared.has(client)) {
    try {
      await client.query(`SET search_path TO ${searchPath}, public`);
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
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

async function withAdvisoryLock(key, work) {
  const client = await acquire();
  const lockValue = hashtext(`advisory:${key}`);
  let transactionActive = false;
  try {
    await client.query("BEGIN");
    transactionActive = true;
    await client.query("SELECT pg_advisory_xact_lock($1)", [lockValue]);
    const result = await work(client);
    await client.query("COMMIT");
    transactionActive = false;
    return result;
  } finally {
    if (transactionActive) {
      try {
        await client.query("ROLLBACK");
      } catch (err) {
        console.error("Error haciendo ROLLBACK del advisory lock:", err.message);
      }
    }
    client.release();
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
