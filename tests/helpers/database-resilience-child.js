const fs = require("node:fs");
const { db } = require("../../src/database");

// plain  → una query trivial (el black-hole nunca contesta el handshake)
// sleep:N→ una query lenta, para separar el timeout del servidor del del cliente
// twice  → la misma query dos veces, para ver si el pool recicló la conexión
// idle  → deja el client ocioso en el pool y espera a que se lo corten
const mode = process.argv[2] || "plain";
const sql = mode === "sleep" ? `select pg_sleep(${Number(process.argv[3])})` : "select 1";

function out(line) {
  // stdout en pipe es async: writeSync evita perder líneas al salir.
  fs.writeSync(1, `${line}\n`);
}

async function attempt() {
  const startedAt = Date.now();
  try {
    await db.query(sql);
    out("RESUELTO");
  } catch (err) {
    out(`RECHAZADO:${err.message}`);
  }
  // El arranque del proceso (require + TLS a Neon) tarda más que la query: el
  // tiempo que importa es el de la query, medido desde adentro.
  out(`QUERY_MS:${Date.now() - startedAt}`);
}

(async () => {
  if (mode === "idle") {
    // Deja el client en el pool como ocioso y se queda vivo. Cuando el servidor
    // corte el socket, pg-pool purga el client y emite 'error': eso escribe en
    // stderr y el test lo lee para verificar cómo se informa.
    await db.query("select 1");
    out("OCIOSO");
    await new Promise((resolve) => setTimeout(resolve, 10000));
    process.exit(0);
  }

  // Con la conexión ya lista (y el statement_timeout ya aplicado), el tiempo que
  // se mide es el de la query y no el del handshake con Neon, que es más lento
  // que la query que se quiere cortar.
  if (mode === "sleep") await db.query("select 1");

  await attempt();

  // La segunda query es la que revela si la conexión envenenada se recicló. Si el
  // pool no la destruyó, la query se encola en el mismo socket —donde su
  // respuesta vendría atribuida a la query abandonada— en vez de abrir una
  // conexión nueva contra el mismo servidor.
  if (mode === "twice") await attempt();

  process.exit(0);
})();
