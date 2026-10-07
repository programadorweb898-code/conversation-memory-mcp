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
      `INSERT INTO session_summary_embeddings (session_id, owner, embedding)
       VALUES ($1, $2, $3)`,
      [sessionId, owner, summaryEmbedding]
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

    const result = await searchSessionsBySummary({
      query: "¿Qué base de datos decidimos usar?",
      project,
      owner: ownerA,
    });

    const history = result.history;

    expect(history).to.have.lengthOf(1);
    expect(history[0].session_id).to.equal(sessionId);
    expect(history[0].content).to.equal("Decidimos usar PostgreSQL.");
  });

  it("recupera el historial por sequence_id aunque timestamp no respete el orden de inserción", async () => {
    const sessionId = "summary-search-sequence-order";
    sessionIds.push(sessionId);

    const first = await saveMessage({
      sessionId,
      project,
      owner: ownerA,
      role: "user",
      content: "Mensaje 1",
    });
    const second = await saveMessage({
      sessionId,
      project,
      owner: ownerA,
      role: "assistant",
      content: "Mensaje 2",
    });
    const third = await saveMessage({
      sessionId,
      project,
      owner: ownerA,
      role: "user",
      content: "Mensaje 3",
    });

    await db.runAsync(
      `UPDATE conversations
       SET timestamp = CASE id
         WHEN $1 THEN CURRENT_TIMESTAMP + INTERVAL '2 hours'
         WHEN $2 THEN CURRENT_TIMESTAMP + INTERVAL '1 hour'
         WHEN $3 THEN CURRENT_TIMESTAMP
       END
       WHERE session_id = $4`,
      [first.messageId, second.messageId, third.messageId, sessionId]
    );

    await db.runAsync(
      `INSERT INTO session_summaries (session_id, project, owner, summary)
       VALUES ($1, $2, $3, $4)`,
      [sessionId, project, ownerA, "Resumen del orden de mensajes"],
    );
    await db.runAsync(
      `INSERT INTO session_summary_embeddings (session_id, owner, embedding)
       VALUES ($1, $2, $3)`,
      [sessionId, ownerA, fakeEmbedding(0.1)]
    );

    const result = await searchSessionsBySummary({
      query: "orden de mensajes",
      project,
      owner: ownerA,
    });

    const history = result.history;

    expect(history.map((message) => message.content)).to.deep.equal([
      "Mensaje 1",
      "Mensaje 2",
      "Mensaje 3",
    ]);
    expect(history.map((message) => message.sequence_id)).to.deep.equal(
      [...history.map((message) => message.sequence_id)].sort((a, b) => Number(a) - Number(b))
    );
  });

  it("limita el historial y permite continuar con afterSequenceId", async () => {
    const sessionId = "summary-search-pagination";
    sessionIds.push(sessionId);

    for (let index = 1; index <= 5; index += 1) {
      await saveMessage({
        sessionId,
        project,
        owner: ownerA,
        role: index % 2 ? "user" : "assistant",
        content: `Mensaje ${index}`,
      });
    }

    await db.runAsync(
      `INSERT INTO session_summaries (session_id, project, owner, summary)
       VALUES ($1, $2, $3, $4)`,
      [sessionId, project, ownerA, "Resumen paginable"],
    );
    await db.runAsync(
      `INSERT INTO session_summary_embeddings (session_id, owner, embedding)
       VALUES ($1, $2, $3)`,
      [sessionId, ownerA, fakeEmbedding(0.1)]
    );

    const firstPageResult = await searchSessionsBySummary({
      query: "paginable",
      project,
      owner: ownerA,
      limit: 2,
    });

    expect(firstPageResult.history.map((message) => message.content)).to.deep.equal([
      "Mensaje 1",
      "Mensaje 2",
    ]);
    expect(firstPageResult.hasMore).to.equal(true);
    expect(firstPageResult.nextAfterSequenceId).to.equal(
      String(firstPageResult.history[1].sequence_id)
    );

    const secondPageResult = await searchSessionsBySummary({
      query: "paginable",
      project,
      owner: ownerA,
      limit: 2,
      afterSequenceId: firstPageResult.nextAfterSequenceId,
    });

    expect(secondPageResult.history.map((message) => message.content)).to.deep.equal([
      "Mensaje 3",
      "Mensaje 4",
    ]);
    expect(secondPageResult.hasMore).to.equal(true);

    const thirdPageResult = await searchSessionsBySummary({
      query: "paginable",
      project,
      owner: ownerA,
      limit: 2,
      afterSequenceId: secondPageResult.nextAfterSequenceId,
    });

    expect(thirdPageResult.history.map((message) => message.content)).to.deep.equal([
      "Mensaje 5",
    ]);
    expect(thirdPageResult.hasMore).to.equal(false);
    expect(thirdPageResult.nextAfterSequenceId).to.equal(null);
  });

  it("respeta el máximo configurado de recuperación del historial", async () => {
    const sessionId = "summary-search-pagination-max";
    sessionIds.push(sessionId);

    for (let index = 1; index <= 4; index += 1) {
      await saveMessage({
        sessionId,
        project,
        owner: ownerA,
        role: "user",
        content: `Mensaje ${index}`,
      });
    }

    await db.runAsync(
      `INSERT INTO session_summaries (session_id, project, owner, summary)
       VALUES ($1, $2, $3, $4)`,
      [sessionId, project, ownerA, "Resumen con límite"],
    );
    await db.runAsync(
      `INSERT INTO session_summary_embeddings (session_id, owner, embedding)
       VALUES ($1, $2, $3)`,
      [sessionId, ownerA, fakeEmbedding(0.1)]
    );

    const { config } = require("../src/config");
    const originalLimit = config.recoverSessionLimit;
    config.recoverSessionLimit = 2;

    try {
      const result = await searchSessionsBySummary({
        query: "límite",
        project,
        owner: ownerA,
        limit: 10,
      });

      expect(result.history).to.have.lengthOf(2);
      expect(result.hasMore).to.equal(true);
    } finally {
      config.recoverSessionLimit = originalLimit;
    }
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

    const result = await searchSessionsBySummary({
      query: "resumen privado",
      project,
      owner: ownerA,
    });

    const history = result.history;

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
      `INSERT INTO session_summary_embeddings (session_id, owner, embedding)
       VALUES ($1, $2, $3)`,
      [sessionId, ownerA, fakeEmbedding(0.1)]
    );

    const result = await searchSessionsBySummary({
      query: "resumen de otro proyecto",
      project,
      owner: ownerA,
    });

    const history = result.history;

    expect(history).to.deep.equal([]);
  });

  it("usa búsqueda textual cuando el resumen no tiene embedding", async () => {
    const sessionId = "summary-search-lexical-fallback";
    sessionIds.push(sessionId);

    await saveMessage({
      sessionId,
      project,
      owner: ownerA,
      role: "user",
      content: "Decidimos usar PostgreSQL",
    });
    await db.runAsync(
      `INSERT INTO session_summaries (session_id, project, owner, summary)
       VALUES ($1, $2, $3, $4)`,
      [sessionId, project, ownerA, "PostgreSQL para persistencia"],
    );

    const result = await searchSessionsBySummary({
      query: "PostgreSQL para persistencia",
      project,
      owner: ownerA,
    });

    const history = result.history;

    expect(history).to.have.lengthOf(1);
    expect(history[0].session_id).to.equal(sessionId);
  });

  it("usa fallback léxico cuando falla la generación del embedding", async () => {
    const sessionId = "summary-search-generation-fallback";
    sessionIds.push(sessionId);

    await saveMessage({
      sessionId,
      project,
      owner: ownerA,
      role: "user",
      content: "Decidimos usar pgvector para búsquedas semánticas",
    });
    await db.runAsync(
      `INSERT INTO session_summaries (session_id, project, owner, summary)
       VALUES ($1, $2, $3, $4)`,
      [sessionId, project, ownerA, "Elegimos pgvector para búsquedas semánticas"],
    );

    embeddingService.generateEmbedding.rejects(new Error("modelo de embeddings no disponible"));

    const result = await searchSessionsBySummary({
      query: "¿Qué decidimos usar para búsquedas?",
      project,
      owner: ownerA,
    });

    const history = result.history;

    expect(history).to.have.lengthOf(1);
    expect(history[0].session_id).to.equal(sessionId);
  });

  it("el fallback léxico puntúa términos relevantes aunque la frase completa no aparezca en el resumen", async () => {
    const sessionId = "summary-search-token-fallback";
    sessionIds.push(sessionId);

    await saveMessage({
      sessionId,
      project,
      owner: ownerA,
      role: "user",
      content: "La decisión fue migrar a pgvector",
    });
    await db.runAsync(
      `INSERT INTO session_summaries (session_id, project, owner, summary)
       VALUES ($1, $2, $3, $4)`,
      [sessionId, project, ownerA, "Migramos las búsquedas semánticas a pgvector"],
    );

    embeddingService.generateEmbedding.rejects(new Error("modelo no disponible"));

    const result = await searchSessionsBySummary({
      query: "¿Qué decisión tomamos sobre pgvector?",
      project,
      owner: ownerA,
    });

    const history = result.history;

    expect(history).to.have.lengthOf(1);
    expect(history[0].session_id).to.equal(sessionId);
  });

  it("incluye agent_id en el historial devuelto", async () => {
    const sessionId = "summary-search-agent-id";
    await createSession({
      sessionId,
      owner: ownerA,
      summary: "Resumen con agent_id",
      summaryEmbedding: fakeEmbedding(0.1),
      content: "Mensaje etiquetado",
    });
    await db.runAsync(
      `UPDATE conversations SET agent_id = 'opencode' WHERE session_id = $1`,
      [sessionId]
    );

    const result = await searchSessionsBySummary({
      query: "agent_id",
      project,
      owner: ownerA,
    });

    const history = result.history;

    expect(history).to.have.lengthOf(1);
    expect(history[0].agent_id).to.equal("opencode");
  });

  it("cae al fallback textual cuando la búsqueda vectorial falla", async () => {
    const sessionId = "summary-search-vector-failure";
    sessionIds.push(sessionId);

    await saveMessage({
      sessionId,
      project,
      owner: ownerA,
      role: "user",
      content: "Mensaje de respaldo",
    });
    await db.runAsync(
      `INSERT INTO session_summaries (session_id, project, owner, summary)
       VALUES ($1, $2, $3, $4)`,
      [sessionId, project, ownerA, "Resumen de respaldo recuperable"],
    );

    const originalAllAsync = db.allAsync.bind(db);
    const stub = sinon.stub(db, "allAsync").callsFake(async (sql, params) => {
      if (sql.includes("session_summary_embeddings")) {
        throw new Error('column "sse.owner" does not exist');
      }
      return originalAllAsync(sql, params);
    });

    try {
      const result = await searchSessionsBySummary({
        query: "resumen de respaldo recuperable",
        project,
        owner: ownerA,
      });

      const history = result.history;

      expect(history).to.have.lengthOf(1);
      expect(history[0].session_id).to.equal(sessionId);
      expect(stub.called).to.equal(true);
    } finally {
      stub.restore();
    }
  });

  it("devuelve vacío cuando no existe ningún resumen elegible", async () => {
    const result = await searchSessionsBySummary({
      query: "consulta sin resultados",
      project,
      owner: ownerA,
    });

    const history = result.history;

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
