const assert = require("node:assert/strict");
const { testDatabaseTarget } = require("./helpers/test-database-target");

describe("3: test database isolation", () => {
  it("never falls back to application credentials", () => {
    assert.throws(() => testDatabaseTarget({ CONVERSATION_MEMORY_DATABASE_URL: "postgres://production" }), /TEST_DATABASE_URL is required/);
  });
  it("rejects reserved schemas and SQL fragments before any connection", () => {
    for (const schema of ["public", "pg_catalog", 'cm_test"; DROP SCHEMA public CASCADE;--']) {
      assert.throws(() => testDatabaseTarget({ TEST_DATABASE_URL: "postgres://test", TEST_SCHEMA: schema }), /TEST_SCHEMA/);
    }
  });
  it("gives concurrent suites separate schemas", () => {
    const env = { TEST_DATABASE_URL: "postgres://test", TEST_SCHEMA: "cm_test_ci" };
    assert.notEqual(testDatabaseTarget(env).schema, testDatabaseTarget(env).schema);
  });
});
