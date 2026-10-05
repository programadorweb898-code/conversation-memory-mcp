const { expect } = require("chai");
const sinon = require("sinon");
const embeddingQueue = require("../src/services/embeddingQueue");

describe("Embedding Queue", function () {
  beforeEach(() => {
    while (!embeddingQueue.isEmpty()) {
      embeddingQueue.getNextTask();
    }
    embeddingQueue.setProcessingStatus(false);
  });

  afterEach(() => sinon.restore());

  it("agrega y recupera tareas en orden FIFO", () => {
    const first = { messageId: "message-1", role: "user", content: "uno" };
    const second = { messageId: "message-2", role: "assistant", content: "dos" };

    embeddingQueue.addTask(first);
    embeddingQueue.addTask(second);

    expect(embeddingQueue.isEmpty()).to.equal(false);
    expect(embeddingQueue.getNextTask()).to.deep.equal(first);
    expect(embeddingQueue.getNextTask()).to.deep.equal(second);
    expect(embeddingQueue.isEmpty()).to.equal(true);
  });

  it("devuelve undefined cuando la cola está vacía", () => {
    expect(embeddingQueue.getNextTask()).to.equal(undefined);
    expect(embeddingQueue.isEmpty()).to.equal(true);
  });

  it("caps the in-memory queue so database polling can recover overflow tasks", () => {
    sinon.stub(console, "log");
    sinon.stub(console, "warn");

    for (let index = 0; index < 1000; index += 1) {
      expect(embeddingQueue.addTask({ messageId: `message-${index}` })).to.equal(true);
    }

    expect(embeddingQueue.addTask({ messageId: "overflow" })).to.equal(false);
    expect(embeddingQueue.size()).to.equal(1000);
    while (!embeddingQueue.isEmpty()) {
      embeddingQueue.getNextTask();
    }
  });

  it("mantiene correctamente el estado de procesamiento", () => {
    expect(embeddingQueue.getProcessingStatus()).to.equal(false);

    embeddingQueue.setProcessingStatus(true);
    expect(embeddingQueue.getProcessingStatus()).to.equal(true);

    embeddingQueue.setProcessingStatus(false);
    expect(embeddingQueue.getProcessingStatus()).to.equal(false);
  });
});
