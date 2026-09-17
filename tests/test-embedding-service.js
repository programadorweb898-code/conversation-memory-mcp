const { expect } = require("chai");
const {
  initializeEmbeddingPipeline,
  generateEmbedding,
  saveEmbedding,
  getEmbedding,
} = require("../src/services/embeddingService");
const { db } = require("./test-helper");

describe("Embedding Service", function () {
  this.timeout(60000);

  const testMessageId = `test-message-embedding-${Date.now()}`;
  const testSessionId = `test-session-embedding-${Date.now()}`;
  const sampleMessage = {
    role: "user",
    content: "Este es un mensaje de prueba para generar un embedding real.",
  };

  after(async () => {
    await db.runAsync("DELETE FROM message_embeddings WHERE message_id = $1", [testMessageId]);
    await db.runAsync("DELETE FROM conversations WHERE id = $1", [testMessageId]);
  });

  it("genera un embedding de 384 dimensiones a partir de un mensaje", async () => {
    await initializeEmbeddingPipeline();

    const embeddingJson = await generateEmbedding(sampleMessage);
    const embedding = JSON.parse(embeddingJson);

    expect(embeddingJson).to.be.a("string");
    expect(embedding).to.be.an("array").with.lengthOf(384);
    expect(embedding.every((value) => typeof value === "number" && Number.isFinite(value))).to.equal(true);
  });

  it("guarda y recupera el embedding sin perder sus valores", async () => {
    await db.runAsync(
      `INSERT INTO conversations (id, session_id, project, role, content)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [testMessageId, testSessionId, "test-project", sampleMessage.role, sampleMessage.content]
    );

    const original = JSON.parse(await generateEmbedding(sampleMessage));
    await saveEmbedding(testMessageId, JSON.stringify(original));

    const retrievedJson = await getEmbedding(testMessageId);
    const retrieved = JSON.parse(retrievedJson);

    expect(retrieved).to.be.an("array").with.lengthOf(original.length);
    retrieved.forEach((value, index) => {
      expect(value).to.be.closeTo(original[index], 1e-6);
    });
  });
});
