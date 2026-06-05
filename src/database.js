const sqlite3 = require("sqlite3").verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, '..', 'conversations.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Error opening database:", err.message);
    return;
  }

  console.log("Connected to SQLite database", dbPath);
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      project TEXT,
      role TEXT NOT NULL,
      content TEXT NOT NULL
    )
  `);
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