const sqlite3 = require("sqlite3").verbose();
const path = require('path');

const DEFAULT_DB_PATH = path.resolve(__dirname, '..', 'conversations.db');
const PROJECT_ROOT = path.resolve(__dirname, '..');

function resolveDbPath(envPath) {
  if (!envPath) return DEFAULT_DB_PATH;
  const resolved = path.resolve(envPath);
  if (!resolved.startsWith(PROJECT_ROOT)) return DEFAULT_DB_PATH;
  const ext = path.extname(resolved);
  if (ext !== '.db' && ext !== '.sqlite' && ext !== '.sqlite3') return DEFAULT_DB_PATH;
  return resolved;
}

const dbPath = resolveDbPath(process.env.DATABASE_PATH);
const db = new sqlite3.Database(dbPath);

let dbReadyResolve;
const dbReadyPromise = new Promise((resolve) => { dbReadyResolve = resolve; });

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
  
  dbReadyResolve();
});

module.exports = { db, dbReadyPromise };