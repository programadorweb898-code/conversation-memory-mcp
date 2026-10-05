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
    // Un solo DELETE por tabla en vez de dos por mensaje: con las suites que
    // corren antes dejando mensajes pendientes (los triviales ya no se
    // embeben por diseño), el bucle fila por fila empujaba el hook más allá de
    // los 30s contra Neon. `embedding_failures` va primero porque su FK a
    // conversations no tiene ON DELETE CASCADE.
    await db.runAsync(
      `DELETE FROM embedding_failures WHERE message_id IN (
         SELECT c.id FROM conversations c
         LEFT JOIN message_embeddings me ON me.message_id = c.id
         WHERE me.message_id IS NULL
       )`
    );
    await db.runAsync(
      `DELETE FROM conversations WHERE id IN (
         SELECT c.id FROM conversations c
         LEFT JOIN message_embeddings me ON me.message_id = c.id
         WHERE me.message_id IS NULL
       )`
    );
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

  it("deduplica el mismo mensaje cuando aparece dos veces en la cola", async () => {
    const messageId = await insertMessage("Mensaje duplicado en cola");
    const task = { messageId, role: "user", content: "Mensaje duplicado en cola" };

    embeddingQueue.addTask(task);
    embeddingQueue.addTask(task);

    const generateEmbeddings = sinon.stub(embeddingService, "generateEmbeddings")
      .resolves([JSON.stringify(fakeEmbedding(0.25))]);
    const saveEmbedding = sinon.stub(embeddingService, "saveEmbedding").resolves();

    await embeddingWorker.processNextEmbeddingTask();

    expect(generateEmbeddings.calledOnce).to.equal(true);
    expect(generateEmbeddings.firstCall.args[0]).to.deep.equal([
      { role: "user", content: "Mensaje duplicado en cola" },
    ]);
    expect(saveEmbedding.calledOnce).to.equal(true);
    expect(saveEmbedding.firstCall.args[0]).to.equal(messageId);
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

  describe("mensaje borrado antes de ser procesado", () => {
    it("termina sin lanzar y sin registrar fallo si el mensaje ya no existe", async () => {
      const messageId = await insertMessage("Mensaje que se borra antes de embeberlo");

      // La tarea queda en la cola en memoria, pero el mensaje desaparece de la
      // base: saveEmbedding falla por FK y recordEmbeddingFailure fallaría igual
      // al insertar en embedding_failures, que también tiene FK.
      embeddingQueue.addTask({
        messageId,
        role: "user",
        content: "Mensaje que se borra antes de embeberlo",
      });
      await db.runAsync(`DELETE FROM conversations WHERE id = $1`, [messageId]);

      sinon.stub(embeddingService, "generateEmbeddings").resolves([JSON.stringify(fakeEmbedding(0.5))]);

      await embeddingWorker.processNextEmbeddingTask();

      const failure = await db.getAsync(
        "SELECT attempts FROM embedding_failures WHERE message_id = $1",
        [messageId]
      );
      expect(failure).to.equal(undefined);
      expect(embeddingQueue.getProcessingStatus()).to.equal(false);
    });

    it("recordEmbeddingFailure no lanza cuando el mensaje no existe", async () => {
      const missingId = uuidv4();

      await embeddingWorker.recordEmbeddingFailure(missingId, new Error("fk violation"));
    });
  });

  describe("startWorker", () => {
    it("waits for an active batch when stopping despite repeated ticks", async () => {
      await insertMessage("Mensaje para validar el apagado del worker");

      let resolveBatch;
      const generatedBatch = new Promise((resolve) => {
        resolveBatch = resolve;
      });
      const generateEmbeddings = sinon.stub(embeddingService, "generateEmbeddings").returns(generatedBatch);
      sinon.stub(embeddingService, "saveEmbedding").resolves();

      let tick;
      const timer = { unref: sinon.spy() };
      const setTimeoutStub = sinon.stub(global, "setTimeout").callsFake((callback) => {
        tick = callback;
        return timer;
      });

      try {
        embeddingWorker.startWorker();
        expect(timer.unref.calledOnce).to.equal(true);

        const firstTick = tick();
        const secondTick = tick();
        expect(firstTick).to.be.a("promise");
        expect(secondTick).to.be.a("promise");

        const deadline = Date.now() + 10000;
        while (!generateEmbeddings.called && Date.now() < deadline) {
          await new Promise((resolve) => setImmediate(resolve));
        }
        expect(generateEmbeddings.calledOnce).to.equal(true);

        let stopped = false;
        const stopPromise = embeddingWorker.stopWorker().then(() => {
          stopped = true;
        });
        await new Promise((resolve) => setImmediate(resolve));
        expect(stopped).to.equal(false);

        resolveBatch([JSON.stringify(fakeEmbedding(0.6))]);
        await Promise.all([firstTick, secondTick, stopPromise]);
        expect(stopped).to.equal(true);
        expect(embeddingQueue.getProcessingStatus()).to.equal(false);
      } finally {
        if (embeddingQueue.getProcessingStatus()) {
          resolveBatch([JSON.stringify(fakeEmbedding(0.6))]);
          await embeddingWorker.stopWorker();
        }
        setTimeoutStub.restore();
      }
    });

    it("does not count model infrastructure failures against individual messages", async () => {
      const messageId = await insertMessage("Mensaje pendiente durante una caída del modelo");
      const infrastructureError = new Error("model download unavailable");
      infrastructureError.code = "EMBEDDING_INFRASTRUCTURE";
      infrastructureError.retryable = true;
      sinon.stub(embeddingService, "generateEmbeddings").rejects(infrastructureError);

      const didWork = await embeddingWorker.processNextEmbeddingTask();
      const failure = await db.getAsync(
        "SELECT attempts FROM embedding_failures WHERE message_id = $1",
        [messageId]
      );
      const embedding = await db.getAsync(
        "SELECT message_id FROM message_embeddings WHERE message_id = $1",
        [messageId]
      );

      expect(didWork).to.equal(false);
      expect(failure).to.equal(undefined);
      expect(embedding).to.equal(undefined);
    });

    it("no genera unhandledRejection cuando processNextEmbeddingTask rechaza", async () => {
      // El intervalo de startWorker captura la referencia local de
      // processNextEmbeddingTask, así que no alcanza con stubear el export:
      // hay que provocar el rechazo por sus dependencias reales.
      const missingId = uuidv4();
      embeddingQueue.addTask({
        messageId: missingId,
        role: "user",
        content: "Mensaje borrado mientras esperaba en la cola",
      });

      sinon.stub(embeddingService, "generateEmbeddings").resolves([JSON.stringify(fakeEmbedding(0.5))]);
      const fkError = new Error('insert or update on table "message_embeddings" violates foreign key constraint');
      fkError.code = "23503";
      sinon.stub(embeddingService, "saveEmbedding").rejects(fkError);

      const unhandled = [];
      const onUnhandled = (reason) => unhandled.push(reason);
      process.on("unhandledRejection", onUnhandled);
      const timer = { unref: sinon.spy() };

      // Se captura el callback que registró startWorker en lugar de usar
      // timers: el intervalo es de 5s y el test necesita esperar a que el
      // trabajo termine de verdad, no a que arrancó.
      let tick;
      const setTimeoutStub = sinon.stub(global, "setTimeout").callsFake((fn) => {
        tick = fn;
        return timer;
      });

      try {
        embeddingWorker.startWorker();
        expect(timer.unref.calledOnce).to.equal(true);
        tick();

        // El 23503 hace que recordEmbeddingFailure intente insertar en una
        // tabla con la misma FK, así que el worker termina rechazando. Hay que
        // esperar a que eso ocurra para poder observar si quedó sin manejar.
        const deadline = Date.now() + 15000;
        while (embeddingQueue.getProcessingStatus() && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(embeddingQueue.getProcessingStatus()).to.equal(false);

        // Los rechazos sin handler se reportan en los próximos ciclos del loop.
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));
      } finally {
        await embeddingWorker.stopWorker();
        setTimeoutStub.restore();
        process.off("unhandledRejection", onUnhandled);
      }

      expect(unhandled).to.deep.equal([]);
    });
  });
});
