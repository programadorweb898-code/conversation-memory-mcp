const { expect } = require("chai");
const sinon = require("sinon");
const { v4: uuidv4 } = require("uuid");
const embeddingService = require("../src/services/embeddingService");
const embeddingQueue = require("../src/services/embeddingQueue");
const embeddingWorker = require("../src/services/embeddingWorker");
const { db } = require("./test-helper");
const fakeEmbedding = require("./helpers/fakeEmbedding");

describe("Embedding Worker", function () {
  this.timeout(15000);

  let messageIds = [];

  beforeEach(async function () {
    this.timeout(30000);
    messageIds = [];
    embeddingQueue.setProcessingStatus(false);
    // El worker procesa pendientes de TODA la base, no solo de este suite: la
    // cola en memoria es un singleton del proceso y la query de pending cubre
    // todos los proyectos. Otras suites que corren antes en el mismo proceso
    // dejan tareas encoladas y conversaciones sin embedding que ensucian las
    // aserciones, así que vaciamos la cola y eliminamos todo mensaje pendiente
    // de la base antes de cada test.
    while (!embeddingQueue.isEmpty()) {
      embeddingQueue.getNextTask();
    }
    const pending = await db.allAsync(
      `SELECT c.id FROM conversations c
       LEFT JOIN message_embeddings me ON me.message_id = c.id
       WHERE me.message_id IS NULL`
    );
    for (const { id } of pending) {
      await db.runAsync("DELETE FROM embedding_failures WHERE message_id = $1", [id]);
      await db.runAsync("DELETE FROM conversations WHERE id = $1", [id]);
    }
    sinon.restore();
  });

  afterEach(async () => {
    sinon.restore();
    embeddingQueue.setProcessingStatus(false);

    for (const messageId of messageIds) {
      await db.runAsync("DELETE FROM embedding_failures WHERE message_id = $1", [messageId]);
      await db.runAsync("DELETE FROM message_embeddings WHERE message_id = $1", [messageId]);
      await db.runAsync("DELETE FROM conversations WHERE id = $1", [messageId]);
    }
  });

  async function insertMessage(content) {
    const messageId = uuidv4();
    messageIds.push(messageId);
    await db.runAsync(
      `INSERT INTO conversations (id, session_id, project, role, content)
       VALUES ($1, $2, $3, $4, $5)`,
      [messageId, `worker-session-${messageId}`, "worker-test", "user", content]
    );
    return messageId;
  }

  it("procesa mensajes pendientes en lote y guarda un embedding por mensaje", async () => {
    const firstId = await insertMessage("Primer mensaje para embedding");
    const secondId = await insertMessage("Segundo mensaje para embedding");

    const generated = [JSON.stringify(fakeEmbedding(0.1)), JSON.stringify(fakeEmbedding(0.2))];
    const generateEmbeddings = sinon.stub(embeddingService, "generateEmbeddings").resolves(generated);
    const saveEmbedding = sinon.stub(embeddingService, "saveEmbedding").resolves();

    await embeddingWorker.processNextEmbeddingTask();

    expect(generateEmbeddings.calledOnce).to.equal(true);
    const generatedMessages = generateEmbeddings.firstCall.args[0];
    expect(generatedMessages).to.have.lengthOf(2);
    expect(generatedMessages.map((message) => message.content)).to.have.members([
      "Primer mensaje para embedding",
      "Segundo mensaje para embedding",
    ]);
    expect(generatedMessages.every((message) => message.role === "user")).to.equal(true);

    const messageIdByContent = new Map([
      ["Primer mensaje para embedding", firstId],
      ["Segundo mensaje para embedding", secondId],
    ]);
    const expectedEmbeddingByMessageId = new Map(
      generatedMessages.map((message, index) => [messageIdByContent.get(message.content), generated[index]])
    );
    const savedByMessageId = new Map(
      saveEmbedding.getCalls().map((call) => [call.args[0], call.args[1]])
    );

    expect(saveEmbedding.calledTwice).to.equal(true);
    expect(savedByMessageId.get(firstId)).to.equal(expectedEmbeddingByMessageId.get(firstId));
    expect(savedByMessageId.get(secondId)).to.equal(expectedEmbeddingByMessageId.get(secondId));
    expect(embeddingQueue.getProcessingStatus()).to.equal(false);
  });

  it("elimina el registro de fallo cuando un mensaje se procesa correctamente", async () => {
    const messageId = await insertMessage("Mensaje que se recupera de un fallo");
    await db.runAsync(
      `INSERT INTO embedding_failures (message_id, attempts, last_error)
       VALUES ($1, $2, $3)`,
      [messageId, 1, "fallo previo"]
    );

    sinon.stub(embeddingService, "generateEmbeddings").resolves([JSON.stringify(fakeEmbedding(0.3))]);
    sinon.stub(embeddingService, "saveEmbedding").resolves();

    await embeddingWorker.processNextEmbeddingTask();

    const failure = await db.getAsync(
      "SELECT attempts FROM embedding_failures WHERE message_id = $1",
      [messageId]
    );
    expect(failure).to.equal(undefined);
  });

  it("hace fallback al procesamiento serial si falla la generación en lote", async () => {
    const messageId = await insertMessage("Mensaje para fallback serial");

    sinon.stub(embeddingService, "generateEmbeddings").rejects(new Error("batch failed"));
    const generateEmbedding = sinon.stub(embeddingService, "generateEmbedding").resolves(JSON.stringify(fakeEmbedding(0.4)));
    const saveEmbedding = sinon.stub(embeddingService, "saveEmbedding").resolves();

    await embeddingWorker.processNextEmbeddingTask();

    expect(generateEmbedding.calledOnce).to.equal(true);
    expect(generateEmbedding.firstCall.args).to.deep.equal([
      { role: "user", content: "Mensaje para fallback serial" },
    ]);
    expect(saveEmbedding.calledOnce).to.equal(true);
    expect(saveEmbedding.firstCall.args).to.deep.equal([messageId, JSON.stringify(fakeEmbedding(0.4))]);
  });

  it("registra fallos y deja de reintentar después de tres intentos", async () => {
    const messageId = await insertMessage("Mensaje que falla siempre");

    sinon.stub(embeddingService, "generateEmbeddings").rejects(new Error("batch failed"));
    const generateEmbedding = sinon.stub(embeddingService, "generateEmbedding").rejects(new Error("model failed"));

    await embeddingWorker.processNextEmbeddingTask();
    await embeddingWorker.processNextEmbeddingTask();
    await embeddingWorker.processNextEmbeddingTask();
    await embeddingWorker.processNextEmbeddingTask();

    const failure = await db.getAsync(
      "SELECT attempts, last_error FROM embedding_failures WHERE message_id = $1",
      [messageId]
    );

    expect(failure.attempts).to.equal(3);
    expect(failure.last_error).to.equal("model failed");
    expect(generateEmbedding.callCount).to.equal(3);
  });

  it("no procesa otra tarea mientras el worker está marcado como ocupado", async () => {
    await insertMessage("Mensaje que no debe procesarse en concurrencia");
    embeddingQueue.setProcessingStatus(true);

    const generateEmbeddings = sinon.stub(embeddingService, "generateEmbeddings");

    await embeddingWorker.processNextEmbeddingTask();

    expect(generateEmbeddings.called).to.equal(false);
    expect(embeddingQueue.getProcessingStatus()).to.equal(true);
  });
});
