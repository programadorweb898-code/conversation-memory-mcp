const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const dotenv = require("dotenv");

dotenv.config();

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");
const MIGRATION_LOCK_KEY = 19082026;

// Dueño por defecto para instalaciones locales. Puede sobrescribirse mediante
// MCP_DEFAULT_OWNER sin impedir que el servidor arranque sin un .env completo.
function getDefaultOwner() {
  return process.env.MCP_DEFAULT_OWNER || "local-user";
}

/**
 * Sustituye los placeholders de entorno dentro del SQL de una migración.
 * Soporta ${MCP_DEFAULT_OWNER}. Devuelve el SQL con los valores resueltos.
 * @param {string} sql - SQL original de la migración.
 * @returns {string}
 */
function resolveEnvPlaceholders(sql) {
  const defaultOwner = getDefaultOwner();

  return sql.replaceAll("${MCP_DEFAULT_OWNER}", defaultOwner);
}

function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is required.");
  }

  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
}

function loadMigrations() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((file) => {
      const match = file.match(/^(\d+)_(.+)\.sql$/);
      return {
        version: Number(match[1]),
        name: file,
        sql: fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"),
      };
    });
}

async function runMigrations({ logger = console } = {}) {
  let pool;
  let client;
  let connectionErrorLogged = false;

  try {
    pool = getPool();

    try {
      client = await pool.connect();
    } catch (error) {
      connectionErrorLogged = true;
      logger.error(
        "No se pudo conectar a la base de datos. Revisá que DATABASE_URL en tu .env sea correcta y que el proyecto de Neon esté activo."
      );
      logger.error(error);
      throw error;
    }
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const { rows: appliedRows } = await client.query(
      "SELECT version FROM schema_migrations ORDER BY version"
    );
    const applied = new Set(appliedRows.map((row) => row.version));
    const migrations = loadMigrations();

    const duplicateVersions = migrations
      .map((migration) => migration.version)
      .filter((version, index, versions) => versions.indexOf(version) !== index);

    if (duplicateVersions.length > 0) {
      throw new Error(
        `Duplicate migration versions found: ${[...new Set(duplicateVersions)].join(", ")}`
      );
    }

    for (const migration of migrations) {
      if (applied.has(migration.version)) {
        continue;
      }

      logger.log(`Applying migration ${migration.name}...`);
      await client.query(resolveEnvPlaceholders(migration.sql));
      await client.query(
        "INSERT INTO schema_migrations (version, name) VALUES ($1, $2)",
        [migration.version, migration.name]
      );
      logger.log(`Migration ${migration.name} applied.`);
    }

    await client.query("COMMIT");
    logger.log("Database migrations completed successfully.");
  } catch (error) {
    if (client) {
      await client.query("ROLLBACK");
    }
    if (!connectionErrorLogged) {
      logger.error("Database migration failed:", error.message);
    }
    throw error;
  } finally {
    client?.release();
    await pool?.end();
  }
}

if (require.main === module) {
  runMigrations().catch(() => process.exit(1));
}

module.exports = { loadMigrations, runMigrations, resolveEnvPlaceholders, getDefaultOwner };
