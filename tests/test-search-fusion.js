const assert = require("node:assert/strict");
const { fuseSearchResults } = require("../src/services/searchFusion");

describe("7: hybrid candidate fusion", () => {
  it("includes unindexed matches alongside semantic results and deduplicates IDs", () => {
    const results = fuseSearchResults(
      [{ id: "indexed", semanticScore: 0.9 }, { id: "both", semanticScore: 0.8 }],
      [{ id: "new", lexicalScore: 1 }, { id: "both", lexicalScore: 0.8 }],
      10
    );
    assert.deepEqual(new Set(results.map(row => row.id)), new Set(["indexed", "new", "both"]));
    assert.equal(results[0].id, "both");
    assert.equal(results[0].semanticScore, 0.8);
    assert.equal(results[0].lexicalScore, 0.8);
    assert.equal(fuseSearchResults(results, [], 1).length, 1);
  });
});
