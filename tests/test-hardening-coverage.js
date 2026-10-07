const { expect } = require("chai");
const fs = require("node:fs");
const path = require("node:path");

describe("Hardening coverage", () => {
  const coverage = [
    [1, "tests/test-recover-session.js"],
    [2, "tests/test-server.js"],
    [3, "tests/test-server.js"],
    [4, "tests/test-server.js"],
    [5, "tests/test-database-transaction.js"],
    [6, "tests/test-search.js"],
    [7, "tests/test-hardening-coverage.js"],
    [8, "tests/test-search-limits.js"],
    [9, "tests/test-recover-session.js"],
    [10, "tests/test-recover-session.js"],
    [11, "tests/test-llm-client.js"],
    [12, "tests/test-llm-client.js"],
    [13, "tests/test-summaries.js"],
    [14, "tests/test-config.js"],
    [15, "tests/test-config.js"],
    [16, "tests/test-server.js"],
    [17, "tests/test-create-mcp-server.js"],
    [18, "tests/test-hardening-coverage.js"],
    [19, ".github/workflows/security-audit.yml"],
    [20, "tests/test-tenant-limits.js"],
  ];

  it("keeps every hardening item mapped to an automated verification", () => {
    for (const [item, relativePath] of coverage) {
      const filePath = path.resolve(__dirname, "..", relativePath);
      expect(fs.existsSync(filePath), `hardening #${item} -> ${relativePath}`).to.equal(true);
    }

    expect(coverage).to.have.lengthOf(20);
    expect(new Set(coverage.map(([item]) => item)).size).to.equal(20);
  });

  it("keeps the dead-code cleanup covered by the repository lint gate", () => {
    const packageJson = require("../package.json");
    expect(packageJson.scripts).to.have.property("lint");
    expect(packageJson.scripts.check).to.include("npm run lint");
  });
});
