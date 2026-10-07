const { expect } = require("chai");
const {
  createEmbeddingReindexer,
  normalizeBatchSize,
  normalizeScope,
} = require("../src/services/embeddingReindex");
const { parseArgs } = require("../scripts/reindex-embeddings");

function createDbDouble({ messagePages = [], summaryPages = [] }) {
  const queries = [];
  const writes = [];
  let messageCalls = 0;
  let summaryCalls = 0;

  return {
    queries,
    writes,
    allAsync: async (sql, params) => {
      queries.push({ sql, params });

      if (sql.includes("FROM conversations c")) {
        return messagePages[messageCalls++] || [];
      }

      if (sql.includes("FROM session_summaries ss")) {
        return summaryPages[summaryCalls++] || [];
      }

      throw new Error("Consulta inesperada");
    },
    runAsync: async (sql, params) => {
      writes.push({ sql, params });
      return { changes: 1 };
    },
  };
}

function createEmbeddingDouble() {
  const generatedCalls = [];
  const saved = [];

  return {
    generatedCalls,
    saved,
    generateEmbeddings: async (messages) => {
      generatedCalls.push(messages);
      return messages.map((message) => `embedding:${message.content}`);
    },
    saveEmbedding: async (messageId, embedding) => {
      saved.push({ messageId, embedding });
    },
  };
}

describe("Embedding Reindex", function () {
  it("normaliza scope y batch size", () => {
    expect(normalizeBatchSize(undefined, 10)).to.equal(10);
    expect(normalizeBatchSize("25", 10)).to.equal(25);
    expect(normalizeScope(undefined)).to.equal("all");
    expect(normalizeScope("messages")).to.equal("messages");
    expect(() => normalizeBatchSize("0", 10)).to.throw("entero positivo");
    expect(() => normalizeScope("invalid")).to.throw("scope inválido");
  });

  it("reindexa mensajes por sequence_id, conserva el cursor y limpia embeddings de mensajes omitidos", async () => {
    const db = createDbDouble({
      messagePages: [
        [
          { id: "m1", sequence_id: 1, role: "user", content: "  mensaje largo 1 " },
          { id: "m2", sequence_id: 2, role: "assistant", content: "corto" },
        ],
        [
          { id: "m3", sequence_id: 3, role: "assistant", content: "mensaje largo 3" },
        ],
        [],
      ],
    });
    const embedding = createEmbeddingDouble();
    const logs = [];
    const reindexer = createEmbeddingReindexer({
      dbClient: db,
      embeddingServiceClient: embedding,
      configClient: {
        embeddings: {
          batchSize: 2,
          minChars: 6,
          maxChars: 10,
        },
      },
      logger: { log: (message) => logs.push(message) },
    });

    const result = await reindexer.reindexMessages({ batchSize: 2 });

    expect(result).to.deep.equal({
      scanned: 3,
      reindexed: 2,
      skipped: 1,
      batches: 2,
    });

    expect(embedding.generatedCalls).to.deep.equal([
      [{ role: "user", content: "mensaje la" }],
      [{ role: "assistant", content: "mensaje la" }],
    ]);

    expect(embedding.saved).to.deep.equal([
      { messageId: "m1", embedding: "embedding:mensaje la" },
      { messageId: "m3", embedding: "embedding:mensaje la" },
    ]);

    expect(db.queries[0].params).to.deep.equal([2]);
    expect(db.queries[1].params).to.deep.equal(["2", 2]);

    const cleanup = db.writes.find((write) => write.sql.includes("DELETE FROM message_embeddings"));
    expect(cleanup.params[0]).to.deep.equal(["m2"]);
    expect(cleanup.params[1]).to.equal(6);
    expect(logs).to.have.lengthOf(2);
  });

  it("aplica aislamiento por owner sin romper el cursor", async () => {
    const db = createDbDouble({
      messagePages: [
        [{ id: "m1", sequence_id: 10, role: "user", content: "mensaje owner" }],
        [],
      ],
    });
    const embedding = createEmbeddingDouble();
    const reindexer = createEmbeddingReindexer({
      dbClient: db,
      embeddingServiceClient: embedding,
      configClient: {
        embeddings: {
          batchSize: 5,
          minChars: 5,
          maxChars: 50,
        },
      },
      logger: { log() {} },
    });

    await reindexer.reindexMessages({ owner: "owner-a", batchSize: 5 });

    expect(db.queries[0].params).to.deep.equal(["owner-a", 5]);
    expect(db.queries[1].params).to.deep.equal(["10", "owner-a", 5]);
  });

  it("no escribe en dry-run, pero recorre y cuenta todas las filas", async () => {
    const db = createDbDouble({
      messagePages: [
        [
          { id: "m1", sequence_id: 1, role: "user", content: "mensaje válido" },
          { id: "m2", sequence_id: 2, role: "user", content: "corto" },
        ],
        [],
      ],
    });
    const embedding = createEmbeddingDouble();
    const reindexer = createEmbeddingReindexer({
      dbClient: db,
      embeddingServiceClient: embedding,
      configClient: {
        embeddings: {
          batchSize: 2,
          minChars: 6,
          maxChars: 50,
        },
      },
      logger: { log() {} },
    });

    const result = await reindexer.reindexMessages({ dryRun: true });

    expect(result).to.deep.equal({
      scanned: 2,
      reindexed: 1,
      skipped: 1,
      batches: 1,
    });
    expect(embedding.generatedCalls).to.deep.equal([]);
    expect(embedding.saved).to.deep.equal([]);
    expect(db.writes).to.deep.equal([]);
  });

  it("reindexa resúmenes con cursor estable timestamp/session/owner y UPSERT compuesto", async () => {
    const db = createDbDouble({
      summaryPages: [
        [
          { session_id: "s1", owner: "a", cursor_timestamp: "2026-01-01 00:00:00.000001", summary: "Resumen uno" },
          { session_id: "s2", owner: "a", cursor_timestamp: "2026-01-01 00:00:00.000001", summary: "Resumen dos" },
        ],
        [
          { session_id: "s3", owner: "b", cursor_timestamp: "2026-01-02 00:00:00.000003", summary: "Resumen tres" },
        ],
        [],
      ],
    });
    const embedding = createEmbeddingDouble();
    const reindexer = createEmbeddingReindexer({
      dbClient: db,
      embeddingServiceClient: embedding,
      configClient: {
        embeddings: {
          batchSize: 2,
          minChars: 6,
          maxChars: 50,
        },
      },
      logger: { log() {} },
    });

    const result = await reindexer.reindexSummaries({ batchSize: 2 });

    expect(result).to.deep.equal({
      scanned: 3,
      reindexed: 3,
      batches: 2,
    });

    expect(embedding.generatedCalls).to.deep.equal([
      [
        { role: "session_summary", content: "Resumen uno" },
        { role: "session_summary", content: "Resumen dos" },
      ],
      [{ role: "session_summary", content: "Resumen tres" }],
    ]);

    expect(db.queries[0].params).to.deep.equal([2]);
    expect(db.queries[1].params).to.deep.equal([
      "2026-01-01 00:00:00.000002",
      "s2",
      "a",
      2,
    ]);

    expect(db.writes[0].params).to.deep.equal(["s1", "a", "embedding:Resumen uno"]);
    expect(db.writes[1].params).to.deep.equal(["s2", "a", "embedding:Resumen dos"]);
    expect(db.writes[2].params).to.deep.equal(["s3", "b", "embedding:Resumen tres"]);
    expect(db.writes.every((write) => write.sql.includes("ON CONFLICT(session_id, owner)"))).to.equal(true);
  });

  it("detiene el lote antes de escribir si el proveedor devuelve una cantidad incorrecta", async () => {
    const db = createDbDouble({
      messagePages: [[
        { id: "m1", sequence_id: 1, role: "user", content: "mensaje válido" },
        { id: "m2", sequence_id: 2, role: "user", content: "otro mensaje válido" },
      ]],
    });
    const embedding = {
      generateEmbeddings: async () => ["solo-uno"],
      saveEmbedding: async () => {
        throw new Error("no debería escribir");
      },
    };
    const reindexer = createEmbeddingReindexer({
      dbClient: db,
      embeddingServiceClient: embedding,
      configClient: {
        embeddings: {
          batchSize: 2,
          minChars: 5,
          maxChars: 50,
        },
      },
      logger: { log() {} },
    });

    let error;
    try {
      await reindexer.reindexMessages({ batchSize: 2 });
    } catch (err) {
      error = err;
    }

    expect(error).to.be.an("error");
    expect(error.message).to.include("cantidad");
    expect(db.writes).to.deep.equal([]);
  });
});

describe("Reindex CLI", () => {
  it("parsea owner, scope, batch size y dry-run", () => {
    expect(parseArgs([
      "--owner", "owner-a",
      "--scope", "summaries",
      "--batch-size", "25",
      "--dry-run",
    ])).to.deep.include({
      owner: "owner-a",
      scope: "summaries",
      batchSize: "25",
      dryRun: true,
    });
  });

  it("rechaza opciones desconocidas", () => {
    expect(() => parseArgs(["--wat"])).to.throw("Opción desconocida");
  });
});
