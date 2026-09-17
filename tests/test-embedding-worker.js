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

  beforeEach(() => {
    messageIds = [];
    embeddingQueue.setProcessingStatus(false);
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
    expect(generateEmbeddings.firstCall.args[0]).to.deep.equal([
      { role: "user", content: "Primer mensaje para embedding" },
      { role: "user", content: "Segundo mensaje para embedding" },
    ]);
    expect(saveEmbedding.calledTwice).to.equal(true);
    expect(saveEmbedding.firstCall.args).to.deep.equal([firstId, generated[0]]);
    expect(saveEmbedding.secondCall.args).to.deep.equal([secondId, generated[1]]);
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
