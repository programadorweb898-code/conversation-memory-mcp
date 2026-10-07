const { expect } = require("chai");
const semanticSearchMessages = require("../src/tools/semanticSearchMessages");
const saveMessage = require("../src/tools/saveMessage");
const embeddingService = require("../src/services/embeddingService");
const { db } = require("./test-helper");

describe("Cross-language semantic search", function () {
  this.timeout(60000);

  const project = `cross-language-search-${Date.now()}`;
  const sessionId = `cross-language-session-${Date.now()}`;
  const messages = [];

  before(async () => {
    await embeddingService.initializeEmbeddingPipeline();

    const seedMessages = [
      {
        role: "assistant",
        content: "Decidimos usar PostgreSQL como base de datos principal.",
      },
      {
        role: "assistant",
        content: "We decided to use PostgreSQL as the primary database.",
      },
      {
        role: "assistant",
        content: "El equipo juega al fútbol los sábados por la mañana.",
      },
    ];

    for (const message of seedMessages) {
      const saved = await saveMessage({
        sessionId,
        project,
        role: message.role,
        content: message.content,
      });

      const embedding = await embeddingService.generateEmbedding(message);
      await embeddingService.saveEmbedding(saved.messageId, embedding);
      messages.push(saved.messageId);
    }
  });

  after(async () => {
    if (messages.length === 0) return;

    await db.runAsync(
      "DELETE FROM message_embeddings WHERE message_id = ANY($1::text[])",
      [messages],
    );
    await db.runAsync(
      "DELETE FROM conversations WHERE id = ANY($1::text[])",
      [messages],
    );
  });

  it("recupera un passage en español con una query en inglés", async () => {
    const results = await semanticSearchMessages({
      query: "Which database did we choose as the primary database?",
      project,
      limit: 3,
    });

    expect(results.map((result) => result.content)).to.include(
      "Decidimos usar PostgreSQL como base de datos principal.",
    );
  });

  it("recupera un passage en inglés con una query en español", async () => {
    const results = await semanticSearchMessages({
      query: "¿Qué base de datos decidimos usar como principal?",
      project,
      limit: 3,
    });

    expect(results.map((result) => result.content)).to.include(
      "We decided to use PostgreSQL as the primary database.",
    );
  });
});
