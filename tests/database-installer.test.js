const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const {
  ensureEnvIgnored,
  upsertEnvValue,
} = require("../src/installer/database");

describe("database installer", () => {
  it("writes DATABASE_URL to .env without duplicating the key", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-db-"));

    upsertEnvValue(cwd, "DATABASE_URL", "postgresql://one");
    upsertEnvValue(cwd, "DATABASE_URL", "postgresql://two");

    const content = readFileSync(join(cwd, ".env"), "utf8");
    assert.equal(content, 'DATABASE_URL="postgresql://two"\n');
  });

  it("keeps unrelated .env variables", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-db-"));

    upsertEnvValue(cwd, "MCP_DEFAULT_OWNER", "local-user");
    upsertEnvValue(cwd, "DATABASE_URL", "postgresql://example");

    const content = readFileSync(join(cwd, ".env"), "utf8");
    assert.match(content, /MCP_DEFAULT_OWNER="local-user"/);
    assert.match(content, /DATABASE_URL="postgresql:\/\/example"/);
  });

  it("adds .env to .gitignore only once", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-db-"));

    assert.equal(ensureEnvIgnored(cwd), true);
    assert.equal(ensureEnvIgnored(cwd), false);

    const content = readFileSync(join(cwd, ".gitignore"), "utf8");
    assert.equal(content, ".env\n");
  });

  it("does not duplicate an existing .env gitignore entry", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-db-"));

    require("node:fs").writeFileSync(join(cwd, ".gitignore"), "node_modules/\n.env\n");
    assert.equal(ensureEnvIgnored(cwd), false);
    assert.equal(readFileSync(join(cwd, ".gitignore"), "utf8"), "node_modules/\n.env\n");
  });
});
