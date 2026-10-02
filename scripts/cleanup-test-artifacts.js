// scripts/cleanup-test-artifacts.js
//
// Limpieza dirigida de los artefactos que los tests dejan en la base real.
//
// Es destructivo: corre en dry-run salvo que se pase --execute, y solo toca
// una lista explícita de proyectos de fixture. No intenta inferir qué es
// "basura" por heuristics: una conversación real mal atribuida es indistinguible
// de un fixture una vez guardada, y borrarla sería peor que dejarla.
//
//   node scripts/cleanup-test-artifacts.js            # dry-run (default)
//   node scripts/cleanup-test-artifacts.js --execute   # aplica
//
// La atribución equivocada (un proyecto real guardado bajo "/" o bajo un nombre
// de otro repo) NO se corrige acá: se reporta para que la resuelva una persona.

const { Pool } = require("pg");
const dotenv = require("dotenv");

dotenv.config();

// Proyectos que solo existen porque corren tests. Ver tests/ para el origen de
// cada nombre. Agregar acá un nombre solo después de confirmar que no hay
// conversación real adentro.
const FIXTURE_PROJECTS = [
  "test",
  "other-project",
  "proj-a",
  "test-project",
  "concurrent-project",
  "neon-b-test",
  "proyecto-A",
];

// Fixtures cuyo nombre incluye un timestamp, generados por los tests en cada
// corrida (tests/test-list-sessions.js, tests/test-recover-session.js).
const FIXTURE_PROJECT_PATTERNS = [
  "^list-sessions-\\d+$",
  "^recover-session-\\d+$",
];

// Proyectos de un harness e2e externo. No se borran automáticamente: se
// reportan, porque no son de este repo y no podemos confirmar que no tengan
// datos que valgan.
const EXTERNAL_FIXTURE_PATTERNS = ["^e2e-memory-audit-\\d+$"];

function projectPredicate(includes) {
  const values = includes.map((name) => `'${name.replaceAll("'", "''")}'`).join(",");
  const patterns = FIXTURE_PROJECT_PATTERNS.map((p) => `project ~ '${p}'`);
  return [`project IN (${values})`, ...patterns].join(" OR ");
}

const EXECUTE = process.argv.includes("--execute");

function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is required.");
  }
  return new Pool({ connectionString: process.env.DATABASE_URL });
}

async function report(client, label, sql, params = []) {
  const { rows } = await client.query(sql, params);
  const count = rows.reduce((total, row) => total + Number(row.n || 0), 0);
  console.log(`  ${label}: ${count}`);
  return count;
}

async function main() {
  const pool = getPool();
  const client = await pool.connect();

  try {
    console.log(EXECUTE ? "MODO EJECUCIÓN" : "MODO DRY-RUN (sin cambios)");

    await client.query("BEGIN");

    const fixtures = projectPredicate(FIXTURE_PROJECTS);

    console.log("\n[Borrar] Conversaciones de proyectos de fixture");
    await report(
      client,
      "mensajes",
      `SELECT count(*) AS n FROM conversations WHERE ${fixtures}`
    );
    await report(
      client,
      "embeddings asociados",
      `SELECT count(*) AS n FROM message_embeddings m
        WHERE m.message_id IN (SELECT id FROM conversations WHERE ${fixtures})`
    );
    await report(
      client,
      "resúmenes de esas sesiones",
      `SELECT count(*) AS n FROM session_summaries
        WHERE session_id IN (SELECT session_id FROM conversations WHERE ${fixtures})`
    );

    console.log("\n[Borrar] Resúmenes huérfanos (su sesión ya no existe)");
    await report(
      client,
      "session_summaries",
      `SELECT count(*) AS n FROM session_summaries ss
        WHERE NOT EXISTS (SELECT 1 FROM conversations c WHERE c.session_id = ss.session_id)`
    );

    console.log("\n[Borrar] Mensajes duplicados exactos (misma sesión, rol y contenido)");
    await report(
      client,
      "copias sobrantes",
      `SELECT COALESCE(sum(n - 1), 0) AS n FROM (
         SELECT count(*) AS n
         FROM conversations
         GROUP BY session_id, role, content
         HAVING count(*) > 1
       ) d`
    );

    console.log("\n[Reportar] Atribución dudosa: requiere decisión manual");
    const externalFixtures = EXTERNAL_FIXTURE_PATTERNS.map((p) => `project ~ '${p}'`).join(" OR ");
    const suspicious = await report(
      client,
      "mensajes en proyecto con nombre de ruta",
      `SELECT count(*) AS n FROM conversations WHERE project ~ '[\\\\/]' OR project IN ('.', '..')`
    );
    const external = await report(
      client,
      "mensajes de fixtures e2e externos",
      `SELECT count(*) AS n FROM conversations WHERE ${externalFixtures}`
    );
    if (suspicious > 0 || external > 0) {
      const { rows } = await client.query(`
        SELECT c.project, count(*) AS mensajes, min(c.timestamp)::date AS desde, max(c.timestamp)::date AS hasta
        FROM conversations c
        WHERE c.project ~ '[\\\\/]' OR c.project IN ('.', '..') OR ${externalFixtures}
        GROUP BY c.project
        ORDER BY 2 DESC
      `);
      console.table(rows);
      console.log("  Estos datos NO se borran: se reenubran a mano con scripts/ si corresponde.");
    }

    // Los duplicados no están en la allowlist de fixtures: viven en proyectos reales
// y sí tienen embedding. Hay que limpiar embedding_failures y message_embeddings
// antes de borrar las filas, porque ninguna de esas dos FK tiene ON DELETE CASCADE
// y sin esto el DELETE aborta toda la transacción.
const duplicatesToDelete = `
  SELECT c.id
  FROM conversations c
  JOIN (
    SELECT session_id, role, content, min(sequence_id) AS keep_seq
    FROM conversations
    GROUP BY session_id, role, content
    HAVING count(*) > 1
  ) d
    ON d.session_id = c.session_id
   AND d.role = c.role
   AND d.content = c.content
  WHERE c.sequence_id > d.keep_seq
`;

async function applyDeletes(client, fixtures) {
  const statements = [
    `DELETE FROM message_embeddings WHERE message_id IN (SELECT id FROM conversations WHERE ${fixtures})`,
    `DELETE FROM conversations WHERE ${fixtures}`,
    `DELETE FROM session_summaries
       WHERE session_id NOT IN (SELECT DISTINCT session_id FROM conversations)`,
    `DELETE FROM embedding_failures WHERE message_id IN (${duplicatesToDelete})`,
    `DELETE FROM message_embeddings WHERE message_id IN (${duplicatesToDelete})`,
    `DELETE FROM conversations WHERE id IN (${duplicatesToDelete})`,
  ];
  const counts = [];
  for (const sql of statements) {
    const result = await client.query(sql);
    counts.push(result.rowCount);
  }
  return counts;
}

const applied = await applyDeletes(client, fixtures);

if (!EXECUTE) {
  await client.query("ROLLBACK");
  console.log(
    `\nEnsayo OK (se aplicó y se revirtió dentro de la transacción): ${applied[1]} conversaciones de fixture, ` +
      `${applied[5]} duplicados, ${applied[2]} resúmenes huérfanos.`
  );
  console.log("Nada fue modificado. Usá --execute para aplicar.");
  return;
}

await client.query("COMMIT");
    console.log(
      `\nAplicado: ${applied[1]} conversaciones de fixture, ${applied[0]} embeddings de fixture, ` +
        `${applied[2]} resúmenes huérfanos, ${applied[5]} duplicados (${applied[4]} embeddings).`
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Limpieza fallida, se revirtió todo:", error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
