const { expect } = require("chai");
const sinon = require("sinon");
const embeddingService = require("../src/services/embeddingService");
const searchSessionsBySummary = require("../src/tools/searchSessionsBySummary");
const saveMessage = require("../src/tools/saveMessage");
const { db } = require("./test-helper");
const fakeEmbedding = require("./helpers/fakeEmbedding");

async function cleanupSession(sessionId) {
  await db.runAsync("DELETE FROM session_summary_embeddings WHERE session_id = $1", [sessionId]);
  await db.runAsync("DELETE FROM session_summaries WHERE session_id = $1", [sessionId]);
  await db.runAsync("DELETE FROM conversations WHERE session_id = $1", [sessionId]);
}

describe("Search Sessions By Summary", function () {
  this.timeout(30000);

  const project = "test-summary-search";
  const ownerA = "summary-owner-a";
  const ownerB = "summary-owner-b";
  let sessionIds = [];

  beforeEach(() => {
    sessionIds = [];
    sinon.stub(embeddingService, "generateEmbedding").resolves(fakeEmbedding(0.1));
  });

  afterEach(async () => {
    sinon.restore();
    for (const sessionId of sessionIds) {
      await cleanupSession(sessionId);
    }
  });

  async function createSession({ sessionId, owner, summary, summaryEmbedding, content }) {
    sessionIds.push(sessionId);
    await saveMessage({
      sessionId,
      project,
      owner,
      role: "user",
      content,
    });

    await db.runAsync(
      `INSERT INTO session_summaries (session_id, project, owner, summary)
       VALUES ($1, $2, $3, $4)`,
      [sessionId, project, owner, summary]
    );
    await db.runAsync(
      `INSERT INTO session_summary_embeddings (session_id, embedding)
       VALUES ($1, $2)`,
      [sessionId, summaryEmbedding]
    );
  }

  it("devuelve el historial completo de la sesión con el resumen más similar", async () => {
    const sessionId = "summary-search-best";
    await createSession({
      sessionId,
      owner: ownerA,
      summary: "Resumen sobre PostgreSQL",
      summaryEmbedding: fakeEmbedding(0.1),
      content: "Decidimos usar PostgreSQL.",
    });

    const history = await searchSessionsBySummary({
      query: "¿Qué base de datos decidimos usar?",
      project,
      owner: ownerA,
    });

    expect(history).to.have.lengthOf(1);
    expect(history[0].session_id).to.equal(sessionId);
    expect(history[0].content).to.equal("Decidimos usar PostgreSQL.");
  });

  it("respeta el aislamiento por owner aunque exista un resumen muy similar de otro owner", async () => {
    const ownerASession = "summary-search-owner-a";
    const ownerBSession = "summary-search-owner-b";

    await createSession({
      sessionId: ownerASession,
      owner: ownerA,
      summary: "Resumen privado de A",
      summaryEmbedding: fakeEmbedding(0.1),
      content: "Dato privado del owner A",
    });
    await createSession({
      sessionId: ownerBSession,
      owner: ownerB,
      summary: "Resumen privado de B",
      summaryEmbedding: fakeEmbedding(0.1),
      content: "Dato privado del owner B",
    });

    const history = await searchSessionsBySummary({
      query: "resumen privado",
      project,
      owner: ownerA,
    });

    expect(history).to.have.lengthOf(1);
    expect(history[0].session_id).to.equal(ownerASession);
    expect(history[0].content).to.equal("Dato privado del owner A");
  });

  it("no devuelve sesiones de otro proyecto", async () => {
    const sessionId = "summary-search-other-project";
    sessionIds.push(sessionId);

    await saveMessage({
      sessionId,
      project: "other-project",
      owner: ownerA,
      role: "user",
      content: "Mensaje de otro proyecto",
    });
    await db.runAsync(
      `INSERT INTO session_summaries (session_id, project, owner, summary)
       VALUES ($1, $2, $3, $4)`,
      [sessionId, "other-project", ownerA, "Resumen de otro proyecto"]
    );
    await db.runAsync(
      `INSERT INTO session_summary_embeddings (session_id, embedding)
       VALUES ($1, $2)`,
      [sessionId, fakeEmbedding(0.1)]
    );

    const history = await searchSessionsBySummary({
      query: "resumen de otro proyecto",
      project,
      owner: ownerA,
    });

    expect(history).to.deep.equal([]);
  });

  it("devuelve vacío cuando no existe ningún resumen elegible", async () => {
    const history = await searchSessionsBySummary({
      query: "consulta sin resultados",
      project,
      owner: ownerA,
    });

    expect(history).to.deep.equal([]);
  });

  it("valida los parámetros obligatorios antes de consultar", async () => {
    let error;
    try {
      await searchSessionsBySummary({ project, owner: ownerA });
    } catch (err) {
      error = err;
    }
    expect(error).to.be.instanceOf(Error);
    expect(error.message).to.include("La consulta no puede estar vacía");

    error = undefined;
    try {
      await searchSessionsBySummary({ query: "hola", owner: ownerA });
    } catch (err) {
      error = err;
    }
    expect(error).to.be.instanceOf(Error);
    expect(error.message).to.include("El parámetro 'project' es obligatorio");
  });
});
