const { Pool } = require('pg');
const dotenv = require('dotenv');
dotenv.config();

// Configuración basada en variables de entorno (Render te dará esta URL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Necesario para conexiones externas en Render
  }
});

// Sin este listener, un error en una conexión idle del pool puede tirar
// el proceso completo (uncaughtException) en vez de solo loguearse.
pool.on('error', (err) => {
  console.error('Error inesperado en el pool de Postgres (conexión idle):', err.message);
});

/**
 * Ejecuta `work` bajo un advisory lock de transacción (pg_advisory_xact_lock).
 * El lock se toma dentro de una transacción explícita sobre una conexión
 * dedicada del pool. Es la única forma confiable en Neon (transaction pooling):
 * un lock de sesión se pierde cuando el proxy rota la sesión al terminar una
 * query en autocommit, mientras que el lock transaccional queda anclado a la
 * transacción activa y se libera automáticamente al hacer COMMIT/ROLLBACK o si
 * se cae la conexión. Los advisory locks son a nivel de cluster, así que
 * serializa también entre procesos/instancias que compartan la base.
 * @param {string} key - Identificador de la sección crítica.
 * @param {Function} work - Trabajo a ejecutar bajo el lock.
 * @returns {Promise<*>} Resultado de `work`.
 */
async function withAdvisoryLock(key, work) {
  const client = await pool.connect();
  const lockValue = hashtext(`advisory:${key}`);
  let transactionActive = false;
  try {
    await client.query(`BEGIN`);
    transactionActive = true;
    await client.query(`SELECT pg_advisory_xact_lock($1)`, [lockValue]);
    const result = await work();
    await client.query(`COMMIT`);
    transactionActive = false;
    return result;
  } finally {
    if (transactionActive) {
      try {
        await client.query(`ROLLBACK`);
      } catch (err) {
        console.error('Error haciendo ROLLBACK del advisory lock:', err.message);
      }
    }
    client.release();
  }
}

/**
 * Hash int4 (equivalente a hashtext() de Postgres) para usar como clave del
 * advisory lock sin depender de funciones SQL en el lado del cliente.
 * @param {string} value
 * @returns {number}
 */
function hashtext(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0; // mantiene int32
  }
  return hash;
}

// Interfaz compatible con nuestras promesas anteriores
const db = {
  query: (sql, params) => pool.query(sql, params),

  // Adaptamos las funciones para mantener compatibilidad
  runAsync: async (sql, params = []) => {
    // Postgres usa $1, $2, etc. en lugar de ?
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
