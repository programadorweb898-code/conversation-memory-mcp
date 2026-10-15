const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { db } = require("./test-helper");
const deleteMessage = require("../src/tools/deleteMessage");
const deleteSession = require("../src/tools/deleteSession");

describe("Review regressions", function () {
  const project = "review-regressions";
  const owner = "review-owner";
  let sessionId;

  beforeEach(() => { sessionId = randomUUID(); });
  afterEach(async () => { await deleteSession({ sessionId, project, owner }); });

  async function insert(role, relatedMessageId = null) {
    const id = randomUUID();
    await db.runAsync(
      `INSERT INTO conversations (id, session_id, project, owner, role, content, related_message_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, sessionId, project, owner, role, "Review regression message", relatedMessageId]
    );
    return id;
  }

  it("1: deleting a question preserves the answer's session and owner", async () => {
    const question = await insert("user");
    const answer = await insert("assistant", question);
    await deleteMessage({ messageId: question, project, owner });
    const row = await db.getAsync("SELECT * FROM conversations WHERE id = $1", [answer]);
    assert.equal(row.related_message_id, null);
    assert.equal(row.session_id, sessionId);
    assert.equal(row.owner, owner);
  });

  it("2: deletion invalidates the summary and its vector", async () => {
    const messageId = await insert("user");
    await db.runAsync(
      "INSERT INTO session_summaries (session_id, owner, project, summary) VALUES ($1, $2, $3, $4)",
      [sessionId, owner, project, "Sensitive derived information"]
    );
    await db.runAsync(
      "INSERT INTO session_summary_embeddings (session_id, owner, embedding) VALUES ($1, $2, $3)",
      [sessionId, owner, JSON.stringify(Array(384).fill(0.1))]
    );
    await deleteMessage({ messageId, project, owner });
    assert.equal(await db.getAsync("SELECT * FROM session_summaries WHERE session_id = $1", [sessionId]), undefined);
    assert.equal(await db.getAsync("SELECT * FROM session_summary_embeddings WHERE session_id = $1", [sessionId]), undefined);
    const { revision } = await db.getAsync("SELECT revision FROM session_revisions WHERE session_id = $1 AND owner = $2", [sessionId, owner]);
    assert.equal(String(revision), "1");
  });

  it("2: in-flight generated summaries cannot restore deleted information", async () => {
    const saveSessionSummary = require("../src/tools/saveSessionSummary");
    const previous = process.env.ENABLE_EMBEDDINGS;
    process.env.ENABLE_EMBEDDINGS = "false";
    try {
      const messageId = await insert("user");
      await deleteMessage({ messageId, project, owner });
      const saved = await saveSessionSummary({ sessionId, project, owner, summary: "Stale secret", lastProcessedSeqId: 1, sourceRevision: "0" });
      assert.equal(saved, false);
      assert.equal(await db.getAsync("SELECT * FROM session_summaries WHERE session_id = $1", [sessionId]), undefined);
    } finally {
      if (previous === undefined) delete process.env.ENABLE_EMBEDDINGS;
      else process.env.ENABLE_EMBEDDINGS = previous;
    }
  });

  it("4: summary reindex traverses real SQL pages, including the owner cursor", async () => {
    const { createEmbeddingReindexer } = require("../src/services/embeddingReindex");
    await db.runAsync(
      "INSERT INTO session_summaries (session_id, owner, project, summary) VALUES ($1, $2, $3, 'Summary')",
      [sessionId, owner, project]
    );
    const reindexer = createEmbeddingReindexer({ logger: { log() {} } });
    const result = await reindexer.reindexSummaries({ owner, batchSize: 1, dryRun: true });
    assert.equal(result.scanned, 1);
    const all = await reindexer.reindexSummaries({ batchSize: 1, dryRun: true });
    assert.ok(all.scanned >= 1);
  });

  it("7: real search queries retain lexical matches with no embedding", async () => {
    const sinon = require("sinon");
    const embeddingService = require("../src/services/embeddingService");
    const searchMessages = require("../src/tools/searchMessages");
    const semanticSearchMessages = require("../src/tools/semanticSearchMessages");
    const oldId = await insert("user");
    const newId = await insert("assistant");
    const vector = JSON.stringify(Array(384).fill(0.1));
    await db.runAsync("INSERT INTO message_embeddings (message_id, embedding) VALUES ($1, $2)", [oldId, vector]);
    const embedding = sinon.stub(embeddingService, "generateEmbedding").resolves(vector);
    const enabled = sinon.stub(embeddingService, "isEmbeddingsEnabled").returns(true);
    try {
      for (const search of [searchMessages, semanticSearchMessages]) {
        const results = await search({ query: "regression", project, owner });
        assert.ok(results.some(row => (row.id ?? row.message_id) === oldId));
        assert.ok(results.some(row => (row.id ?? row.message_id) === newId));
      }
    } finally { embedding.restore(); enabled.restore(); }
  });

  it("9: concurrent source-message retries return one persistent ID", async () => {
    const saveMessage = require("../src/tools/saveMessage");
    const args = { sessionId, project, owner, role: "user", content: "Retryable message", sourceMessageId: "external-question" };
    const results = await Promise.all([saveMessage(args), saveMessage(args)]);
    assert.equal(results[0].messageId, results[1].messageId);
    const rows = await db.allAsync("SELECT id FROM conversations WHERE session_id = $1", [sessionId]);
    assert.equal(rows.length, 1);
    await assert.rejects(() => saveMessage({ ...args, content: "Different content" }), { code: "IDEMPOTENCY_CONFLICT" });
  });

  it("11: the public manual-summary handler can update a generated summary without leaving its old vector", async () => {
    const { createSaveSessionSummaryHandler } = require("../src/mcpTools");
    const saveSummary = require("../src/tools/saveSessionSummary");
    const { runWithAuth } = require("../src/context");
    const messageId = await insert("user");
    const message = await db.getAsync("SELECT sequence_id FROM conversations WHERE id = $1", [messageId]);
    await db.runAsync(
      "INSERT INTO session_summaries (session_id, owner, project, summary, last_processed_seq_id) VALUES ($1, $2, $3, 'Generated summary', $4)",
      [sessionId, owner, project, message.sequence_id]
    );
    await db.runAsync("INSERT INTO session_summary_embeddings (session_id, owner, embedding) VALUES ($1, $2, $3)", [sessionId, owner, JSON.stringify(Array(384).fill(0.1))]);
    const previous = process.env.ENABLE_EMBEDDINGS;
    process.env.ENABLE_EMBEDDINGS = "false";
    try {
      const result = await runWithAuth({ owner }, () => createSaveSessionSummaryHandler(saveSummary)({ sessionId, project, summary: "Manual correction" }));
      assert.notEqual(result.isError, true);
      const row = await db.getAsync("SELECT * FROM session_summaries WHERE session_id = $1", [sessionId]);
      assert.equal(row.summary, "Manual correction");
      assert.equal(String(row.last_processed_seq_id), String(message.sequence_id));
      assert.equal(await db.getAsync("SELECT * FROM session_summary_embeddings WHERE session_id = $1", [sessionId]), undefined);
    } finally {
      if (previous === undefined) delete process.env.ENABLE_EMBEDDINGS;
      else process.env.ENABLE_EMBEDDINGS = previous;
    }
  });

  it("12: latest context returns the recent tail and paginates older messages without gaps", async () => {
    const getLastSessionContext = require("../src/tools/getLastSessionContext");
    const ids = [await insert("user"), await insert("assistant"), await insert("user")];
    const page = await getLastSessionContext({ project, owner, limit: 2 });
    assert.equal(page.sessionId, sessionId);
    assert.deepEqual(page.messages.map(row => row.id), ids.slice(1));
    assert.equal(page.hasMore, true);
    assert.equal(page.truncated, true);
    const older = await getLastSessionContext({ sessionId, project, owner, limit: 2, beforeSequenceId: page.nextBeforeSequenceId });
    assert.deepEqual(older.messages.map(row => row.id), ids.slice(0, 1));
    assert.equal(older.hasMore, false);
    assert.equal(older.nextBeforeSequenceId, null);
    const otherOwner = await getLastSessionContext({ sessionId, project, owner: "another-owner" });
    assert.equal(otherOwner.messages.length, 0);
  });
});
