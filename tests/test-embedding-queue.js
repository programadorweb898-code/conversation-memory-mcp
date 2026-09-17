const { expect } = require("chai");
const embeddingQueue = require("../src/services/embeddingQueue");

describe("Embedding Queue", function () {
  beforeEach(() => {
    while (!embeddingQueue.isEmpty()) {
      embeddingQueue.getNextTask();
    }
    embeddingQueue.setProcessingStatus(false);
  });

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

  it("mantiene correctamente el estado de procesamiento", () => {
    expect(embeddingQueue.getProcessingStatus()).to.equal(false);

    embeddingQueue.setProcessingStatus(true);
    expect(embeddingQueue.getProcessingStatus()).to.equal(true);

    embeddingQueue.setProcessingStatus(false);
    expect(embeddingQueue.getProcessingStatus()).to.equal(false);
  });
});
