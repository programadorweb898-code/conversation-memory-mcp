const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const dotenv = require("dotenv");
const { getConfig } = require("../src/config");
const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");
const { describeDatabaseTarget, getDatabaseUrl } = require("../src/databaseConfig");

dotenv.config();

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");
const MIGRATION_LOCK_KEY = 19082026;

async function confirmMigrationTarget(connectionString, input = stdin, output = stdout) {
  const target = describeDatabaseTarget(connectionString);
  output.write("Destino de migración:\n");
  output.write(`  Host: ${target.host}\n`);
  output.write(`  Base: ${target.database}\n`);
  output.write(`  Schema: ${getConfig().database.searchPath || "public"}\n`);
  output.write("Confirmá que esta base está dedicada exclusivamente a Conversation Memory y autorizás las migraciones [s/N]: ");

  const prompt = readline.createInterface({ input, output });
  try {
    const answer = (await prompt.question("")).trim().toLowerCase();
    return ["s", "si", "sí", "y", "yes"].includes(answer);
  } finally {
    prompt.close();
  }
}

function getDefaultOwner() {
  return getConfig().database.defaultOwner;
}

function escapeSqlLiteral(value) {
  return String(value).replaceAll("'", "''");
}

function resolveEnvPlaceholders(sql) {
  const defaultOwner = escapeSqlLiteral(getDefaultOwner());
  return sql.replaceAll("${MCP_DEFAULT_OWNER}", defaultOwner);
}

// Schema donde se aplican las migraciones. Mismo criterio que src/database.js.
// El `SET` se hace al adquirir la conexión, no en el evento "connect": pg-pool
// no espera al handler del evento y el `SET` competiría con el `BEGIN`.
function getSearchPath() {
  const searchPath = process.env.PG_SEARCH_PATH;
  if (searchPath && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(searchPath)) {
    throw new Error(`PG_SEARCH_PATH inválido: "${searchPath}"`);
  }
  return searchPath;
}

function getPool() {
  const connectionString = getDatabaseUrl();
  if (!connectionString) {
    throw new Error("CONVERSATION_MEMORY_DATABASE_URL environment variable is required.");
  }

  return new Pool({
    connectionString,
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

async function runMigrations({ logger = console, confirmed = false } = {}) {
  if (!confirmed) {
    throw new Error("Migration refused: confirm the dedicated Conversation Memory database before running migrations.");
  }

  let pool;
  let client;
  let connectionErrorLogged = false;

  try {
    pool = getPool();
    const searchPath = getSearchPath();

    try {
      client = await pool.connect();
    } catch (error) {
      connectionErrorLogged = true;
      logger.error(
        "No se pudo conectar a la base de datos. Revisá CONVERSATION_MEMORY_DATABASE_URL y que el proyecto de Neon esté activo."
      );
      logger.error(error);
      throw error;
    }

    if (searchPath) {
      await client.query(`SET search_path TO ${searchPath}, public`);
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
      if (applied.has(migration.version)) continue;

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
    if (client) await client.query("ROLLBACK");
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
  (async () => {
    const connectionString = getDatabaseUrl();
    if (!connectionString) {
      throw new Error("CONVERSATION_MEMORY_DATABASE_URL environment variable is required.");
    }

    const confirmed = await confirmMigrationTarget(connectionString);
    if (!confirmed) throw new Error("Migración cancelada.");
    await runMigrations({ confirmed: true });
  })().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  loadMigrations,
  confirmMigrationTarget,
  runMigrations,
  resolveEnvPlaceholders,
  getDefaultOwner,
};
