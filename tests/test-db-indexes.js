const { expect } = require("chai");
const { db } = require("./test-helper");

async function indexExists(indexName) {
  const row = await db.getAsync(
    "SELECT 1 AS present FROM pg_indexes WHERE schemaname = current_schema() AND indexname = $1",
    [indexName],
  );
  return Boolean(row);
}

describe("Database query indexes", () => {
  it("crea los índices compuestos de recuperación y aislamiento", async () => {
    for (const indexName of [
      "idx_conversations_session_project_owner_sequence",
      "idx_conversations_project_owner_sequence",
      "idx_conversations_project_owner_agent_session_timestamp",
      "idx_session_summaries_project_owner_timestamp",
    ]) {
      expect(await indexExists(indexName)).to.equal(true, indexName);
    }
  });

  it("crea los índices trigram para los fallbacks léxicos", async () => {
    expect(await indexExists("idx_conversations_content_trgm")).to.equal(true);
    expect(await indexExists("idx_session_summaries_summary_trgm")).to.equal(true);

    const extension = await db.getAsync(
      "SELECT 1 AS present FROM pg_extension WHERE extname = 'pg_trgm'",
    );
    expect(extension).to.exist;
  });
});
