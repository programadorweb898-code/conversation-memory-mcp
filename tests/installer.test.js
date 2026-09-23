const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { installPolicy, detectAgent } = require("../src/installer");

describe("memory policy installer", () => {
  it("creates AGENTS.md with the policy by default", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-"));
    const result = installPolicy({ cwd });
    assert.equal(result.agent, "generic");
    assert.equal(result.created, true);
    assert.match(readFileSync(join(cwd, "AGENTS.md"), "utf8"), /conversation-memory-mcp/);
  });

  it("does not duplicate an existing policy", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-"));
    installPolicy({ cwd });
    const second = installPolicy({ cwd });
    assert.equal(second.changed, false);
    const content = readFileSync(join(cwd, "AGENTS.md"), "utf8");
    assert.equal((content.match(/conversation-memory-mcp:memory-priority-policy/g) || []).length, 1);
  });

  it("updates the managed block instead of duplicating it", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-"));
    installPolicy({ cwd });
    const file = join(cwd, "AGENTS.md");
    const before = readFileSync(file, "utf8");
    installPolicy({ cwd, agent: "codex" });
    const after = readFileSync(file, "utf8");
    assert.equal((after.match(/conversation-memory-mcp:memory-priority-policy/g) || []).length, 1);
    assert.ok(after.includes("## Prioridad de memoria conversacional"));
    assert.ok(after.length >= before.length);
  });

  it("supports agent-specific instruction files", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-"));
    const claude = installPolicy({ cwd, agent: "claude" });
    const copilot = installPolicy({ cwd, agent: "copilot" });
    assert.equal(claude.file, join(cwd, "CLAUDE.md"));
    assert.equal(copilot.file, join(cwd, ".github", "copilot-instructions.md"));
  });

  it("detects an existing instruction file", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-"));
    writeFileSync(join(cwd, "CLAUDE.md"), "# Project\n");
    assert.equal(detectAgent(cwd), "claude");
  });
});
