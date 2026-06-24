const { Pool } = require('pg');
const dotenv=require("dotenv");
dotenv.config();
// Configuración basada en variables de entorno (Render te dará esta URL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Necesario para conexiones externas en Render
  }
});

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

// Inicialización de tablas
async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        project TEXT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        agent_id TEXT
      );
    `);
    
    await client.query(`CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_conversations_session_id ON conversations(session_id)`);
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS message_embeddings (
        message_id TEXT PRIMARY KEY,
        embedding TEXT NOT NULL,
        FOREIGN KEY(message_id) REFERENCES conversations(id)
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS session_summaries (
        session_id TEXT PRIMARY KEY,
        summary TEXT NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("Tablas inicializadas correctamente en Postgres.");
  } catch (err) {
    console.error("Error inicializando tablas:", err);
  } finally {
    client.release();
  }
}

initDb();

module.exports = { db };
