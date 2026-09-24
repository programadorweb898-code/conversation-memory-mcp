const { Pool } = require("pg");
const dotenv = require("dotenv");
dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.on("error", (err) => {
  console.error("Error inesperado en el pool de Postgres (conexión idle):", err.message);
});

/**
 * Ejecuta work bajo un advisory lock de transacción.
 * work recibe la misma conexión que posee el lock, garantizando que la
 * sección crítica queda protegida también entre procesos/instancias.
 */
async function withAdvisoryLock(key, work) {
  const client = await pool.connect();
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
  query: (sql, params) => pool.query(sql, params),
  runAsync: async (sql, params = []) => {
    const result = await pool.query(sql, params);
    return { changes: result.rowCount };
  },
  getAsync: async (sql, params = []) => {
    const result = await pool.query(sql, params);
    return result.rows[0];
  },
  allAsync: async (sql, params = []) => {
    const result = await pool.query(sql, params);
    return result.rows;
  },
  close: async () => {
    await pool.end();
  }
};

module.exports = { db, withAdvisoryLock };
