const sqlite3 = require("sqlite3").verbose();
const path = require('path');

// DESPUÉS
const DEFAULT_DB_PATH = path.resolve(__dirname, '..', 'conversations.db');
const PROJECT_ROOT = path.resolve(__dirname, '..');

function resolveDbPath(envPath) {
  if (!envPath) return DEFAULT_DB_PATH;

  const resolved = path.resolve(envPath);

  // bloquear path traversal: el archivo debe estar dentro del proyecto
  if (!resolved.startsWith(PROJECT_ROOT)) {
    console.error(
      `DATABASE_PATH inválido: "${resolved}" está fuera del directorio del proyecto.`
    );
    console.error(`Usando path por defecto: ${DEFAULT_DB_PATH}`);
    return DEFAULT_DB_PATH;
  }

  // bloquear extensiones peligrosas
  const ext = path.extname(resolved);
  if (ext !== '.db' && ext !== '.sqlite' && ext !== '.sqlite3') {
    console.error(
      `DATABASE_PATH inválido: extensión "${ext}" no permitida.`
    );
    return DEFAULT_DB_PATH;
  }

  return resolved;
}

const dbPath = resolveDbPath(process.env.DATABASE_PATH);

console.time("⏱️ Database initialization");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Error opening database:", err.message);
    // Optionally, re-throw or handle the error more robustly depending on application needs
    return;
  }

  // Only log if not in-memory, to avoid excessive logging during tests
  if (dbPath !== ':memory:') {
    console.log("Connected to SQLite database", dbPath);
  }

  // Cargar la extensión sqlite-vss

});

db.runAsync = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });

db.getAsync = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });

db.allAsync = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });

let dbReadyResolve;
const dbReadyPromise = new Promise((resolve) => {
  dbReadyResolve = resolve;
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      project TEXT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      agent_id TEXT
    );
  `);
  db.all(`PRAGMA table_info(conversations)`, (err, columns) => {
    if (err) {
      console.error("Error checking conversations schema:", err.message);
      return;
    }

    const hasAgentId = columns.some((column) => column.name === "agent_id");
    if (!hasAgentId) {
      db.run(`ALTER TABLE conversations ADD COLUMN agent_id TEXT`, (alterErr) => {
        if (alterErr) {
          console.error("Error adding agent_id column:", alterErr.message);
        }
      });
    }

    db.run(`CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_conversations_session_id ON conversations(session_id)`);
    
    // FTS5 Initialization - Asegurar ejecución forzada
    console.log("Intentando crear FTS5...");
    db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS conversations_fts USING fts5(id UNINDEXED, content);`, (err) => {
      if (err) {
        console.error("CRITICAL ERROR: Failed to create FTS5 table:", err.message);
        // No exit, let's see if other things run
      } else {
        console.log("FTS5 table ready.");
      }
    });

    db.run(`
      CREATE TRIGGER IF NOT EXISTS conversations_ai AFTER INSERT ON conversations BEGIN
        INSERT INTO conversations_fts(id, content) VALUES (new.id, new.content);
      END;
    `);
    db.run(`
      CREATE TRIGGER IF NOT EXISTS conversations_ad AFTER DELETE ON conversations BEGIN
        DELETE FROM conversations_fts WHERE id = old.id;
      END;
    `);
    db.run(`
      CREATE TRIGGER IF NOT EXISTS conversations_au AFTER UPDATE ON conversations BEGIN
        UPDATE conversations_fts SET content = new.content WHERE id = new.id;
      END;
    `);
    // Populate FTS5 if empty
    db.run(`INSERT INTO conversations_fts(id, content) SELECT id, content FROM conversations WHERE NOT EXISTS(SELECT 1 FROM conversations_fts);`);

    db.run(`
      CREATE TABLE IF NOT EXISTS message_embeddings (
        message_id TEXT PRIMARY KEY,
        embedding TEXT NOT NULL,
        FOREIGN KEY(message_id) REFERENCES conversations(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS session_summaries (
        session_id TEXT PRIMARY KEY,
        summary TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.timeEnd("⏱️ Database initialization");
    dbReadyResolve();
  });
});

module.exports = { db, dbReadyPromise };
