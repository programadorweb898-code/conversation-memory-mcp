// tests/test-save-session-summary.js
//
// Cobertura de la atomicidad entre el resumen de una sesión y su embedding.
//
// El objetivo es que session_summaries y session_summary_embeddings no puedan
// quedar desalineados: si el embedding falla, el watermark no debe avanzar; y
// con dos saveSessionSummary en paralelo sobre la misma sesión, el embedding
// guardado tiene que corresponder al resumen que quedó guardado.

const { expect } = require("chai");
const sinon = require("sinon");
const { v4: uuidv4 } = require("uuid");
const { db } = require("./test-helper");

const PROJECT = "test";

// saveSessionSummary destructura generateEmbedding al cargarse, así que stubear
// el módulo embeddingService no alcanza: hay que inyectarlo antes de que el
// módulo se cargue. Es el mismo patrón que usaba la suite del session monitor.
const embeddingServicePath = require.resolve("../src/services/embeddingService");
const saveSessionSummaryPath = require.resolve("../src/tools/saveSessionSummary");

function loadSaveSessionSummary(generateEmbedding) {
  delete require.cache[saveSessionSummaryPath];
  const original = require.cache[embeddingServicePath];
  require.cache[embeddingServicePath] = {
    id: embeddingServicePath,
    filename: embeddingServicePath,
    loaded: true,
    exports: { generateEmbedding },
  };

  const loaded = require("../src/tools/saveSessionSummary");

  if (original) {
    require.cache[embeddingServicePath] = original;
  } else {
    delete require.cache[embeddingServicePath];
  }

  return loaded;
}

// Extrae los primeros valores del vector guardado para poder distinguir uno de
// otro sin comparar los 384 componentes.
function leadingValues(embedding, count = 8) {
  return embedding
    .replace(/[[\]]/g, "")
    .split(",")
    .slice(0, count)
    .map(Number);
}

function vector(seed) {
  return `[${Array(384).fill(seed).join(",")}]`;
}

describe("Atomicidad de saveSessionSummary", function () {
  this.timeout(30000);

  const sessions = [];

  beforeEach(() => {
    sessions.length = 0;
    delete require.cache[saveSessionSummaryPath];
  });

  afterEach(async () => {
    sinon.restore();
    delete require.cache[saveSessionSummaryPath];
    for (const sessionId of sessions.splice(0)) {
      await db.runAsync(`DELETE FROM session_summary_embeddings WHERE session_id = $1`, [sessionId]);
      await db.runAsync(`DELETE FROM session_summaries WHERE session_id = $1`, [sessionId]);
      await db.runAsync(`DELETE FROM conversations WHERE session_id = $1`, [sessionId]);
    }
  });

  function readSummary(sessionId) {
    return db.getAsync(
      `SELECT summary, last_processed_seq_id FROM session_summaries WHERE session_id = $1`,
      [sessionId]
    );
  }

  function readEmbedding(sessionId) {
    return db
      .getAsync(
        `SELECT embedding::text AS embedding FROM session_summary_embeddings WHERE session_id = $1`,
        [sessionId]
      )
      .then((row) => (row ? row.embedding : null));
  }

  it("conserva el resumen y su embedding cuando hay dos escrituras concurrentes con watermarks distintos", async () => {
    const sessionId = `atomic-summary-${uuidv4()}`;
    sessions.push(sessionId);
    const owner = "atomic-owner";

    // El watermark MENOR tarda más en generar su embedding, así que llega al
    // UPSERT del embedding después que el MAYOR. Sin la guarda por watermark en
    // el UPSERT del embedding, el vector viejo termina pisando al nuevo.
    const generateEmbedding = sinon.stub();
    generateEmbedding.withArgs(sinon.match({ content: "Resumen nuevo" })).callsFake(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return vector(0.9);
    });
    generateEmbedding.withArgs(sinon.match({ content: "Resumen viejo" })).callsFake(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return vector(0.1);
    });

    const saveSessionSummary = loadSaveSessionSummary(generateEmbedding);

    // El UPSERT de resumen del watermark MENOR tiene que ocurrir primero, y el
    // embedding del watermark MENOR tiene que escribirse después. El segundo
    // orden viene de los retardos del stub; el primero se espera mirando la
    // base en vez de con un timeout fijo, porque el round-trip a Neon desde
    // fuera de la región no permite fijar un delay confiable.
    const started = saveSessionSummary({
      sessionId,
      project: PROJECT,
      owner,
      summary: "Resumen viejo",
      lastProcessedSeqId: 10,
    });

    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const current = await readSummary(sessionId);
      if (current) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const wroteNew = await saveSessionSummary({
      sessionId,
      project: PROJECT,
      owner,
      summary: "Resumen nuevo",
      lastProcessedSeqId: 20,
    });
    const wroteOld = await started;

    // Ambas escrituras son legítimas por separado: el resumen viejo entra
    // primero (watermark 10) y después lo actualiza el nuevo (20). Lo que no
    // puede pasar es que el embedding que sobreviva sea el del resumen viejo.
    expect(wroteOld).to.equal(true);
    expect(wroteNew).to.equal(true);

    const summary = await readSummary(sessionId);
    expect(summary.summary).to.equal("Resumen nuevo");
    expect(Number(summary.last_processed_seq_id)).to.equal(20);

    // El embedding guardado tiene que ser el del resumen que quedó guardado.
    const embedding = await readEmbedding(sessionId);
    expect(embedding).to.not.equal(null);
    expect(leadingValues(embedding)[0]).to.be.closeTo(0.9, 0.001);
  });

  it("no toca session_summaries si la generación del embedding falla, y conserva el resumen previo", async () => {
    const sessionId = `atomic-summary-${uuidv4()}`;
    sessions.push(sessionId);
    const owner = "atomic-owner";

    const okStub = sinon.stub().resolves(vector(0.7));
    await loadSaveSessionSummary(okStub)({
      sessionId,
      project: PROJECT,
      owner,
      summary: "Resumen previo",
      lastProcessedSeqId: 5,
    });

    const previous = await readSummary(sessionId);
    expect(previous.summary).to.equal("Resumen previo");
    expect(Number(previous.last_processed_seq_id)).to.equal(5);

    const failingStub = sinon.stub().rejects(new Error("model failed"));
    const saveSessionSummary = loadSaveSessionSummary(failingStub);

    let thrown;
    try {
      await saveSessionSummary({
        sessionId,
        project: PROJECT,
        owner,
        summary: "Resumen nuevo",
        lastProcessedSeqId: 30,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown, "generateEmbedding debe propagar el error").to.be.an("error");
    expect(thrown.message).to.equal("model failed");

    // El watermark no debe haber avanzado: si avanzara, los mensajes nuevos
    // quedarían marcados como procesados sin resumen que los cubra.
    const after = await readSummary(sessionId);
    expect(after.summary).to.equal("Resumen previo");
    expect(Number(after.last_processed_seq_id)).to.equal(5);

    // Y el embedding guardado sigue siendo el del resumen previo.
    const embedding = await readEmbedding(sessionId);
    expect(leadingValues(embedding)[0]).to.be.closeTo(0.7, 0.001);
  });
});