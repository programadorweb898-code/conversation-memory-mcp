// scripts/reattribute-orphans.js
//
// Reenumeración de conversaciones huérfanas guardadas bajo project='/'.
//
// El plugin resolvía el proyecto una sola vez al arrancar, con el worktree
// global de opencode, así que sesiones que corrieron en otro directorio
// quedaron bajo una clave que no era la suya. Estos mensajes son reales: son
// turnos de conversación guardados con el `project` equivocado, no fixtures.
//
// El destino NO se infiere del contenido. Sale de `session.directory` en el
// storage de opencode (~/.local/share/opencode/opencode.db), que es la fuente
// de verdad de qué directorio tenía abierta cada sesión. El mapeo está
// hardcodeado abajo para que quede revisable: si algo cambia, hay que editar
// este archivo a mano, no dejar que un script lo adivine.
//
//   node scripts/reattribute-orphans.js            # dry-run (default), ROLLBACK
//   node scripts/reattribute-orphans.js --execute   # aplica
//
// Qué NO toca: embeddings y resúmenes de sesión. El vector se calcula sobre el
// texto del mensaje, no sobre el proyecto, así que mover de proyecto no
// invalida nada. `timestamp`, `content` y `agent_id` tampoco cambian.
//
// Idempotente: las filas ya movidas no aparecen en el plan, así que correrlo
// dos veces no hace nada la segunda.

const { Pool } = require("pg");
const dotenv = require("dotenv");

dotenv.config();

// Mapeo explícito sesión -> proyecto.
// Origen: opencode.db, tabla `session`, campo `directory`.
//
//   ses_f110c7834...  C:/Users/gomit/corralon_proyect
//   ses_f0c6a64ff...  C:/Users/gomit/corralon_proyect
//   ses_f3e821272...  C:/Users/gomit            (home, sin repo abierto)
//   ses_f3e7e3a9c...  C:/Users/gomit            (home, sin repo abierto)
//
// Las 13 del home NO son de ningún repo: opencode no tiene un proyecto para ese
// path y no existe carpeta engram ni similar en el disco. Van a `sin-proyecto`
// para que no queden en un limbo ni mezcladas con la memoria de un repo real.
const SESSION_TARGETS = {
  ses_f110c7834ffea4XUmGd1vJ8S3S: "corralon_proyect",
  ses_f0c6a64ffffeYIrbBPotc12EpD: "corralon_proyect",
  ses_f3e821272ffeLTLeo86W224NMM: "sin-proyecto",
  ses_f3e7e3a9cffe6yKnIpVSF0X0ts: "sin-proyecto",
};

const SOURCE_PROJECT = "/";
const EXECUTE = process.argv.includes("--execute");

function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is required.");
  }
  return new Pool({ connectionString: process.env.DATABASE_URL });
}

// Una fila que no aparece en SESSION_TARGETS es un dato huérfano sin destino
// conocido. Se reporta y no se toca.
async function buildPlan(client) {
  const entries = Object.entries(SESSION_TARGETS);
  const ids = entries.map(([id]) => id);
  const idList = ids.map((id) => `'${id}'`).join(",");

  const { rows } = await client.query(
    `SELECT session_id, project, role, count(*)::int AS n,
            min(timestamp) AS desde, max(timestamp) AS hasta
       FROM conversations
      WHERE project = $1 AND session_id IN (${idList})
      GROUP BY session_id, project, role
      ORDER BY session_id, role`,
    [SOURCE_PROJECT]
  );

  const known = new Set(rows.map((r) => r.session_id));
  const unplanned = ids.filter((id) => !known.has(id));

  // Sesiones huérfanas que no están en el mapeo. Se listan para que el mapeo
  // se actualice a mano si aparecen más.
  const { rows: orphans } = await client.query(
    `SELECT session_id, count(*)::int AS n
       FROM conversations
      WHERE project = $1 AND session_id NOT IN (${idList})
      GROUP BY session_id ORDER BY session_id`,
    [SOURCE_PROJECT]
  );

  const target = new Map(entries);
  const plan = rows.map((r) => ({ ...r, to: target.get(r.session_id) }));

  return { plan, unplanned, orphans };
}

async function run() {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { plan, unplanned, orphans } = await buildPlan(client);
    const total = plan.reduce((acc, r) => acc + r.n, 0);

    console.log(`\n[Plan] Reenumerar mensajes de project='${SOURCE_PROJECT}'`);
    console.log("=" .repeat(78));

    if (plan.length === 0) {
      console.log("  Ningún mensaje pendiente. No hay nada que mover.");
    } else {
      console.table(
        plan.map((r) => ({
          sesion: r.session_id.slice(0, 20) + "…",
          role: r.role,
          n: r.n,
          desde: new Date(r.desde).toISOString().slice(0, 16).replace("T", " "),
          hasta: new Date(r.hasta).toISOString().slice(0, 16).replace("T", " "),
          de: r.project,
          a: r.to,
        }))
      );

      const byTarget = new Map();
      for (const r of plan) {
        byTarget.set(r.to, (byTarget.get(r.to) || 0) + r.n);
      }
      console.log(`  Total a mover: ${total}`);
      for (const [to, n] of [...byTarget].sort()) {
        console.log(`    -> ${to}: ${n}`);
      }
    }

    if (unplanned.length > 0) {
      console.log(`\n  [AVISO] Sesiones del mapeo sin filas en '${SOURCE_PROJECT}':`);
      for (const id of unplanned) console.log(`    - ${id}`);
    }

    if (orphans.length > 0) {
      const n = orphans.reduce((acc, r) => acc + r.n, 0);
      console.log(`\n  [SIN DESTINO] ${orphans.length} sesión(es), ${n} mensaje(s) sin mapeo:`);
      for (const r of orphans) console.log(`    - ${r.session_id} (${r.n} mensajes)`);
      console.log(
        "    No se tocan. Si querés moverlas, agregá el session_id a SESSION_TARGETS."
      );
    }

    if (plan.length === 0) {
      await client.query("ROLLBACK");
      return;
    }

    // Un solo statement para todas las filas: si algo falla, no queda la
    // mitad movida. Los valores vienen del mapea hardcodeado de arriba.
    await client.query(
      `UPDATE conversations c
          SET project = v.target_project
         FROM (VALUES ${plan
           .map((r) => `('${r.session_id}', '${r.to}')`)
           .join(",")}) AS v(session_id, target_project)
        WHERE c.session_id = v.session_id
          AND c.project = $1`,
      [SOURCE_PROJECT]
    );

    const { rows: check } = await client.query(
      `SELECT project, count(*)::int AS n
         FROM conversations
        WHERE session_id IN (${Object.keys(SESSION_TARGETS).map((i) => `'${i}'`).join(",")})
        GROUP BY project ORDER BY project`
    );

    console.log("\n[Verificación dentro de la transacción]");
    for (const r of check) {
      console.log(`  ${r.project.padEnd(22)} ${r.n}`);
    }
    const remaining = check.find((r) => r.project === SOURCE_PROJECT);
    if (remaining && remaining.n > 0) {
      throw new Error(
        `Abortado: quedan ${remaining.n} filas en '${SOURCE_PROJECT}' tras el UPDATE.`
      );
    }

    if (EXECUTE) {
      await client.query("COMMIT");
      console.log(`\n[OK] Aplicado. ${total} mensajes reenumerados.`);
    } else {
      await client.query("ROLLBACK");
      console.log("\n[DRY-RUN] ROLLBACK. Nada se persistió.");
      console.log("  Para aplicar: node scripts/reattribute-orphans.js --execute");
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(`\n[ERROR] ${error.message}`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();