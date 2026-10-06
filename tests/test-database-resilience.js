const assert = require("node:assert/strict");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const CHILD = path.join(__dirname, "helpers", "database-resilience-child.js");
const DEADLINE_MS = 25000;

// ---------------------------------------------------------------- child runner

function startChild({ args = [], env = {} } = {}) {
  const childEnv = { ...process.env, ...env };
  delete childEnv.PG_SEARCH_PATH;
  delete childEnv.PGSSLMODE;
  delete childEnv.PGSSL_REJECT_UNAUTHORIZED;

  const child = spawn(process.execPath, [CHILD, ...args], {
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  // `output` se va llenando mientras el child corre: hay tests que necesitan
  // leer la primera respuesta antes de que termine.
  const state = { output: "", timedOut: false };

  const timer = setTimeout(() => {
    state.timedOut = true;
    child.kill();
  }, DEADLINE_MS);

  child.stdout.on("data", (chunk) => { state.output += chunk; });
  child.stderr.on("data", (chunk) => { state.output += chunk; });
  child.stdout.on("error", () => {});
  child.stderr.on("error", () => {});

  state.done = new Promise((resolve) => {
    child.on("close", () => {
      clearTimeout(timer);
      resolve(state);
    });
  });

  state.kill = () => child.kill();
  return state;
}

async function runChildToCompletion(options) {
  const child = startChild(options);
  const { output, timedOut } = await child.done;

  assert.equal(timedOut, false, `el child quedó colgado ${DEADLINE_MS}ms: ${output}`);
  return { output };
}

function waitForOutput(child, pattern, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, rejectWait) => {
    const check = setInterval(() => {
      if (pattern.test(child.output)) {
        clearInterval(check);
        resolve(child.output);
        return;
      }
      if (Date.now() > deadline) {
        clearInterval(check);
        rejectWait(new Error(`el child no emitió ${pattern} en ${timeoutMs}ms: ${child.output}`));
      }
    }, 50);
  });
}

function assertTimeoutFired(output, maxMs) {
  const match = /QUERY_MS:(\d+)/.exec(output);
  assert.ok(match, `el child no reportó el tiempo de la query: ${output}`);
  assert.ok(
    Number(match[1]) < maxMs,
    `la query no se cortó en ${maxMs}ms (tardó ${match[1]}ms, el statement era de 3s): ${output}`,
  );
}

// ---------------------------------------------------------------- fake servers

// Acepta el TCP y no responde nunca: ni siquiera el handshake. Sirve para probar
// el timeout de conexión.
function startBlackHoleServer() {
  const sockets = [];
  const server = net.createServer((socket) => sockets.push(socket));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `postgres://user:secret@127.0.0.1:${server.address().port}/no_db`,
        close: () => {
          for (const socket of sockets) socket.destroy();
          server.close();
        },
      });
    });
  });
}

function message(type, payload = Buffer.alloc(0)) {
  const header = Buffer.alloc(5);
  header.write(type, 0, "ascii");
  header.writeInt32BE(payload.length + 4, 1);
  return Buffer.concat([header, payload]);
}

function int32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32BE(value);
  return buffer;
}

function int16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeInt16BE(value);
  return buffer;
}

function cstring(value) {
  return Buffer.concat([Buffer.from(value, "utf8"), Buffer.from([0])]);
}

const authenticationOk = () => message("R", int32(0));
const parameterStatus = (key, value) => message("S", Buffer.concat([cstring(key), cstring(value)]));
const backendKeyData = () => message("K", Buffer.concat([int32(1), int32(1)]));
const readyForQuery = () => message("Z", Buffer.from("I"));
const commandComplete = (tag) => message("C", cstring(tag));

// RowDescription: Int16 campos, y por campo name\0 + tableOID + attrNum +
// typeOID + typeLen + typeMod + formatCode (Int16, no Int32).
const rowDescription = () =>
  message(
    "T",
    Buffer.concat([int16(1), cstring("?column?"), int32(0), int16(0), int32(23), int16(4), int32(-1), int16(0)]),
  );
const dataRow = (value) => message("D", Buffer.concat([int16(1), int32(value.length), Buffer.from(value)]));

// Completa el handshake como Postgres (AuthenticationOk + ReadyForQuery) y
// responde solo a los SET, dejando cualquier otra query sin respuesta. Es el
// peor caso posible: el cliente cree que está conectado y el servidor acepta el
// tráfico sin contestarle nunca.
function startSilentPostgresServer({ answerEveryQuery = false } = {}) {
  const sockets = [];
  let accepted = 0;

  const server = net.createServer((socket) => {
    accepted += 1;
    sockets.push(socket);
    let buffer = Buffer.alloc(0);
    let handshaken = false;

    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      if (!handshaken) {
        if (buffer.length < 8) return;
        const length = buffer.readInt32BE(0);
        if (buffer.length < length) return;
        handshaken = true;
        buffer = buffer.subarray(length);
        socket.write(authenticationOk());
        socket.write(parameterStatus("server_version", "14.0"));
        socket.write(parameterStatus("client_encoding", "UTF8"));
        socket.write(backendKeyData());
        socket.write(readyForQuery());
      }

      // Simple Query: 'Q' + Int32 length + sql\0
      while (buffer.length >= 5 && buffer[0] === 0x51) {
        const length = buffer.readInt32BE(1);
        if (buffer.length < 1 + length) return;
        const statement = buffer.subarray(5, 1 + length - 1).toString("utf8");
        buffer = buffer.subarray(1 + length);

        if (answerEveryQuery || /^\s*SET\b/i.test(statement)) {
          if (/^\s*SELECT\b/i.test(statement)) {
            socket.write(rowDescription());
            socket.write(dataRow("1"));
            socket.write(commandComplete("SELECT 1"));
          } else {
            socket.write(commandComplete("SET"));
          }
          socket.write(readyForQuery());
        }
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `postgres://user:secret@127.0.0.1:${server.address().port}/no_db`,
        connections: () => accepted,
        // Simula que el compute se suspende o reinicia: el socket muere sin
        // FIN limpio, que es lo que dispara el error de conexión ociosa.
        dropAll: () => {
          for (const socket of sockets) socket.destroy();
        },
        whenConnections: (target, timeoutMs) => new Promise((resolveWait, rejectWait) => {
          if (accepted >= target) return resolveWait();
          const check = setInterval(() => {
            if (accepted < target) return;
            clearInterval(check);
            resolveWait();
          }, 50);
          setTimeout(() => {
            clearInterval(check);
            rejectWait(new Error(`el pool no abrió la conexión #${target} en ${timeoutMs}ms`));
          }, timeoutMs);
        }),
        close: () => {
          for (const socket of sockets) socket.destroy();
          server.close();
        },
      });
    });
  });
}

// ---------------------------------------------------------------------- tests

describe("database resilience", function () {
  this.timeout(40000);

  it("falla rápido cuando el endpoint acepta la conexión pero nunca responde", async () => {
    const server = await startBlackHoleServer();

    try {
      const { output } = await runChildToCompletion({
        env: { CONVERSATION_MEMORY_DATABASE_URL: server.url },
      });

      assert.match(output, /RECHAZADO:/);
      assert.match(output, /connection timeout/i);
    } finally {
      server.close();
    }
  });

  it("corta la query lenta en el servidor y deja la conexión reutilizable", async () => {
    const { output } = await runChildToCompletion({
      args: ["sleep", "3"],
      env: {
        CONVERSATION_MEMORY_DATABASE_URL: process.env.CONVERSATION_MEMORY_DATABASE_URL,
        CONVERSATION_MEMORY_QUERY_TIMEOUT_MS: "800",
      },
    });

    assert.match(output, /RECHAZADO:/);
    assert.match(output, /statement timeout/i);
    assertTimeoutFired(output, 2500);
  });

  it("informa el corte de una conexión ociosa como algo que se recupera solo", async () => {
    const server = await startSilentPostgresServer({ answerEveryQuery: true });
    const child = startChild({
      args: ["idle"],
      env: { CONVERSATION_MEMORY_DATABASE_URL: server.url },
    });

    try {
      await waitForOutput(child, /OCIOSO/);
      server.dropAll();

      // El corte de una conexión ociosa no requiere acción: el pool ya la purgó
      // y abre una nueva al próximo query. Se informa como informativo y con el
      // detalle que haga falta para diagnosticar.
      await waitForOutput(child, /Conexión ociosa cerrada por el servidor/);
      assert.doesNotMatch(child.output, /Error inesperado/);
    } finally {
      child.kill();
      server.close();
    }
  });

  it("destruye la conexión cuando el timeout del cliente se adelanta al del servidor", async () => {
    const server = await startSilentPostgresServer();
    const child = startChild({
      args: ["twice"],
      env: {
        CONVERSATION_MEMORY_DATABASE_URL: server.url,
        CONVERSATION_MEMORY_QUERY_TIMEOUT_MS: "200",
      },
    });

    try {
      // El timeout del cliente solo se dispara cuando el servidor no puede
      // cancelar nada, así que hace falta un servidor mudo que aun así complete
      // el handshake.
      await server.whenConnections(2, 20000);
      assert.match(child.output, /Query read timeout/);

      // Si el pool hubiera devuelto al pool la conexión desincronizada, la
      // segunda query se encolaría en el mismo socket y su respuesta sería la de
      // la query abandonada. Una conexión nueva prueba que la anterior se
      // destruyó.
      assert.ok(
        server.connections() >= 2,
        `el pool recicló la conexión envenenada (conexiones abiertas: ${server.connections()})`,
      );
    } finally {
      child.kill();
      server.close();
    }
  });
});
