// Chequeo de schema al arrancar el servidor. El código nuevo puede requerir
// columnas/tablas que una base ya migrada no tiene (p. ej. `project_path`): si se
// sirve con el schema viejo, el guardado falla en el momento de escribir, lejos
// de la causa. Este guard compara las migraciones empaquetadas con
// `schema_migrations` y, por defecto, se niega a arrancar si falta alguna.
//
// Con CONVERSATION_MEMORY_AUTO_MIGRATE=true aplica las pendientes solo, sin el
// gate interactivo (pensado para quien acepta el DDL automático a sabiendas).
const logger = require("./logger");
const { getConfig } = require("./config");
const { db } = require("./database");
const { loadMigrations, runMigrations } = require("../scripts/migrate");

// Código de Postgres para "relation does not exist": la tabla de migraciones
// todavía no existe (base sin inicializar), así que no hay ninguna aplicada.
const UNDEFINED_TABLE = "42P01";

async function readAppliedVersions(allAsync) {
  try {
    const rows = await allAsync("SELECT version FROM schema_migrations ORDER BY version");
    return new Set(rows.map((row) => Number(row.version)));
  } catch (error) {
    if (error.code === UNDEFINED_TABLE) return new Set();
    throw error;
  }
}

async function ensureSchemaUpToDate({
  allAsync = db.allAsync,
  migrations = loadMigrations(),
  autoMigrate = getConfig().database.autoMigrate,
  migrate = runMigrations,
  log = logger,
} = {}) {
  const applied = await readAppliedVersions(allAsync);
  const pending = migrations.filter((migration) => !applied.has(migration.version));

  if (pending.length === 0) {
    return { status: "ok", pending: [] };
  }

  const names = pending.map((migration) => migration.name).join(", ");

  if (autoMigrate) {
    log.log(
      `Schema desactualizado: aplicando ${pending.length} migración(es) por ` +
        `CONVERSATION_MEMORY_AUTO_MIGRATE=true: ${names}`
    );
    await migrate({ logger: log, confirmed: true });
    return { status: "migrated", pending };
  }

  const error = new Error(
    `Schema desactualizado: faltan ${pending.length} migración(es): ${names}. ` +
      "Ejecutá `conversation-memory-mcp migrate` antes de iniciar el servidor, o definí " +
      "CONVERSATION_MEMORY_AUTO_MIGRATE=true para aplicarlas automáticamente al arrancar."
  );
  error.code = "SCHEMA_OUTDATED";
  error.pending = pending.map((migration) => migration.name);
  throw error;
}

// Variante fail-open para el arranque: solo es fatal un schema desactualizado
// (decisión correcta) o un fallo al migrar. Si no se puede determinar el estado
// (base inalcanzable, timeout), se avisa y se sigue: un blip de red no debe
// impedir arrancar y el error real se reporta por request.
async function guardStartupSchema(options = {}) {
  const log = options.log || logger;
  try {
    return await ensureSchemaUpToDate(options);
  } catch (error) {
    if (error.code === "SCHEMA_OUTDATED") throw error;
    log.error(
      `No se pudo verificar el schema antes de arrancar (${error.message}). ` +
        "Se continúa; si el schema está desactualizado, los errores aparecerán al escribir."
    );
    return { status: "unverified", error };
  }
}

module.exports = { ensureSchemaUpToDate, guardStartupSchema, readAppliedVersions };
