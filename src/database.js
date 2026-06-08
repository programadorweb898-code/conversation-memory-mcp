const sqlite3 = require("sqlite3").verbose();
const path = require('path');

const dbPath = process.env.DATABASE_PATH || path.resolve(__dirname, '..', 'conversations.db');

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
  });
  db.run(`CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_conversations_session_id ON conversations(session_id)`);
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
});

module.exports = db;
