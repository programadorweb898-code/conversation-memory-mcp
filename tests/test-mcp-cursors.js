const assert = require("node:assert/strict");
const { registerMcpTools } = require("../src/mcpTools");

describe("5: public MCP cursor schemas", () => {
  it("accepts numeric summary cursors and rejects malformed ones", () => {
    const schemas = new Map();
    registerMcpTools({ tool(name, description, schema) { schemas.set(name, schema); } });
    for (const name of ["searchSessionsBySummary", "recoverSession"]) {
      const cursor = schemas.get(name).afterSequenceId;
      assert.equal(cursor.parse("123"), "123");
      assert.equal(cursor.parse("0"), "0");
      assert.equal(cursor.safeParse("\\ddd").success, false);
      assert.equal(cursor.safeParse("1.5").success, false);
    }
  });
});
