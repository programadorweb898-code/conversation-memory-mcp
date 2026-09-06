/*
 * Migración: backfill de la columna `project` en registros históricos.
 *
 * Asigna un proyecto a los mensajes/resúmenes que tienen `project IS NULL`.
 *
 * Estrategia por sesión (prioridad):
 *   1. Si la sesión ya tiene `project` en alguna de sus filas, se reutiliza ese valor.
 *   2. Si no, se usa el mapeo explícito de SESSION_PROJECT_MAP (editable abajo).
 *   3. Si no, se infiere el proyecto a partir del nombre del session_id.
 *   4. Si no se puede inferir, se usa DEFAULT_PROJECT.
 *
 * IMPORTANTE: este script corre contra la BD de Neon. Asegurate de que
 * DATABASE_URL en .env apunte a Neon (no al Postgres viejo de Render) antes de ejecutarlo.
 *
 * Uso:
 *   node scripts/migrate_project_backfill.js            # dry-run (no modifica nada)
 *   node scripts/migrate_project_backfill.js --apply    # aplica los cambios
 */

const { db } = require("../src/database");
const { runMigrations } = require("./migrate");

// Mapeo explícito sesión -> proyecto. Alineá los nombres con los que envía tu plugin/agente.
const SESSION_PROJECT_MAP = {
  "sesion-inicial-jarvis-tv": "jarvis-tv",
  "session-2026-08-03-frontend-e-commerce": "frontend-e-commerce",
  "manual-save-portafolio": "portafolio",
  "session-authentication-system-2026-07-28": "system-authentication",
  "babkend-senior-session-001": "babkend-senior",
  "active_session_babkend_senior": "babkend-senior",
  "babkend-auth-session-2026-07-23": "babkend-auth",
  "global-agents-md-20260819": "global-agents-md",
};

const DEFAULT_PROJECT = "default";

function assertNeonDatabase() {
  const url = process.env.DATABASE_URL || "";
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    host = "";
  }
  if (!host) {
    console.error("ERROR: DATABASE_URL no está configurada o no es válida. Revisá tu .env.");
    process.exit(1);
  }
  if (host.includes("render.com")) {
    console.error(
      `ERROR: DATABASE_URL apunta al Postgres de Render (${host}). ` +
        "Este proyecto usa NEON. Actualizá DATABASE_URL en .env con la conexión de Neon " +
        "(panel de Neon -> Connection Details) antes de migrar."
    );
    process.exit(1);
  }
  if (!host.includes("neon.tech")) {
    console.warn(
      `ADVERTENCIA: el host '${host}' no parece ser de Neon (esperado *.neon.tech). ` +
        "Si no estás seguro, abortá y verificá DATABASE_URL."
    );
  }
}

function inferProject(sessionId) {
  if (SESSION_PROJECT_MAP[sessionId]) {
    return SESSION_PROJECT_MAP[sessionId];
  }

  // Heurística por nombre del session_id
  let s = String(sessionId).toLowerCase();
  s = s.replace(/^(session|sesion|active|init|current|manual[-_]?save)[-_]/i, "");
  s = s.replace(/^(init|session|sesion|active|current)[-_]?/g, "");
  // Remover fechas (2026-08-03, 20260819) y números sueltos al final
  s = s.replace(/\d{4}([-_]\d{1,2}){1,2}[-_]?/g, "");
  s = s.replace(/\d+$/g, "");
  s = s.replace(/[-_]?session[-_]?/g, "");
  s = s.replace(/[-_]+/g, "-").replace(/^-|-$/g, "");

  return s.length >= 3 ? s : null;
}

async function ensureProjectColumn() {
  await db.runAsync("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS project TEXT");
  await db.runAsync("ALTER TABLE session_summaries ADD COLUMN IF NOT EXISTS project TEXT");
  console.log("Columna 'project' garantizada en conversations y session_summaries.");
}

async function getSessionsToFix() {
  return db.allAsync(`
    SELECT
      c.session_id,
      COUNT(*)::int AS total_rows,
      COUNT(c.project)::int AS rows_with_project,
      COUNT(DISTINCT c.project)::int AS distinct_projects,
      (
        SELECT project
        FROM conversations
        WHERE session_id = c.session_id AND project IS NOT NULL
        GROUP BY project
        ORDER BY COUNT(*) DESC, project ASC
        LIMIT 1
      ) AS dominant_project
    FROM conversations c
    GROUP BY c.session_id
    HAVING COUNT(c.project) < COUNT(*)
  `);
}

function resolveProject(session) {
  if (session.dominant_project) return session.dominant_project;
  const inferred = inferProject(session.session_id);
  return inferred || DEFAULT_PROJECT;
}

function projectSource(session) {
  if (session.dominant_project && session.distinct_projects === 1) return "existente";
  if (session.dominant_project && session.distinct_projects > 1) return "mixto";
  if (SESSION_PROJECT_MAP[session.session_id]) return "map";
  if (inferProject(session.session_id)) return "inferencia";
  return "default";
}

async function run() {
  const apply = process.argv.includes("--apply");
  assertNeonDatabase();
  await runMigrations();
  await ensureProjectColumn();

  const sessions = await getSessionsToFix();
  if (sessions.length === 0) {
    console.log("No hay sesiones con project NULL. Nada que migrar.");
    process.exit(0);
  }

  console.log(`Sesiones a revisar: ${sessions.length}`);

  for (const session of sessions) {
    const project = resolveProject(session);
    const source = projectSource(session);
    console.log(
      `${apply ? "[APPLY]" : "[DRY-RUN]"} ${session.session_id} -> ${project} (${source}) ` +
      `[${session.total_rows - session.rows_with_project} registros sin project]`
    );

    if (!apply) continue;

    await db.runAsync(
      `UPDATE conversations SET project = $1 WHERE session_id = $2 AND project IS NULL`,
      [project, session.session_id]
    );

    await db.runAsync(
      `UPDATE session_summaries SET project = $1 WHERE session_id = $2 AND project IS NULL`,
      [project, session.session_id]
    );
  }

  if (apply) {
    console.log("Backfill aplicado correctamente.");
  } else {
    console.log("Dry-run finalizado. Usá --apply para aplicar los cambios.");
  }
}

run().catch((error) => {
  console.error("Error en migrate_project_backfill:", error);
  process.exit(1);
});
