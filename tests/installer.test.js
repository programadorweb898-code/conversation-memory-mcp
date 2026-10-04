const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { install, detectAgent } = require("../src/installer");

describe("installer", () => {
  it("installs policy and MCP for OpenCode", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-"));
    const result = install({ cwd, agent: "opencode" });
    assert.equal(result.agent, "opencode");
    const config = JSON.parse(readFileSync(join(cwd, ".opencode", "opencode.json"), "utf8"));
    assert.equal(config.mcp.servers["conversation-memory"].type, "local");
  });

  it("installs project MCP config for Claude and Cursor", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-"));
    install({ cwd, agent: "claude" });
    install({ cwd, agent: "cursor" });
    assert.ok(existsSync(join(cwd, ".mcp.json")));
    assert.ok(existsSync(join(cwd, ".cursor", "mcp.json")));
  });

  it("installs Kimi and Kiro MCP configs", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-"));
    install({ cwd, agent: "kimi" });
    install({ cwd, agent: "kiro-ide" });
    assert.ok(existsSync(join(cwd, ".kimi-code", "mcp.json")));
    assert.ok(existsSync(join(cwd, ".kiro", "settings", "mcp.json")));
  });

  it("installs Codex project config", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-"));
    install({ cwd, agent: "codex" });
    assert.match(readFileSync(join(cwd, ".codex", "config.toml"), "utf8"), /mcp_servers\.conversation-memory/);
  });

  it("is idempotent", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-"));
    const first = install({ cwd, agent: "cursor" });
    const second = install({ cwd, agent: "cursor" });
    assert.equal(first.mcp.changed, true);
    assert.equal(second.mcp.changed, false);
    assert.equal(second.changed, false);
  });

  it("installs Gemini CLI MCP in project scope by default", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-"));
    const result = install({ cwd, agent: "gemini-cli" });
    assert.equal(result.agent, "gemini-cli");
    assert.equal(result.mcp.supported, true);
    assert.equal(result.mcp.scope, "project");
    const config = JSON.parse(readFileSync(join(cwd, ".gemini", "settings.json"), "utf8"));
    assert.equal(config.mcpServers["conversation-memory"].command, "npx");
    assert.deepEqual(config.mcpServers["conversation-memory"].args, ["-y", "conversation-memory-mcp"]);
    assert.ok(existsSync(join(cwd, "GEMINI.md")));
  });

  it("installs Gemini CLI MCP globally without modifying the real home in tests", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-"));
    const homeDir = mkdtempSync(join(tmpdir(), "conversation-memory-home-"));
    const result = install({ cwd, agent: "gemini-cli", scope: "global", homeDir });
    assert.equal(result.mcp.supported, true);
    assert.equal(result.mcp.scope, "global");
    assert.equal(result.mcp.file, join(homeDir, ".gemini", "settings.json"));
    assert.ok(!existsSync(join(cwd, ".gemini", "settings.json")));
    const config = JSON.parse(readFileSync(result.mcp.file, "utf8"));
    assert.equal(config.mcpServers["conversation-memory"].command, "npx");
  });

  it("installs OpenClaw MCP through its CLI in global scope", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-"));
    const homeDir = mkdtempSync(join(tmpdir(), "conversation-memory-openclaw-home-"));
    const configFile = join(homeDir, ".openclaw", "openclaw.json");
    let command;

    const result = install({
      cwd,
      agent: "openclaw",
      scope: "global",
      homeDir,
      commandRunner: (...args) => {
        command = args;
      },
    });

    assert.equal(result.agent, "openclaw");
    assert.equal(result.mcp.supported, true);
    assert.equal(result.mcp.scope, "global");
    assert.equal(result.mcp.file, configFile);
    assert.equal(command[0], process.platform === "win32" ? "openclaw.cmd" : "openclaw");
    assert.deepEqual(command[1], [
      "mcp",
      "set",
      "conversation-memory",
      JSON.stringify({
        command: "npx",
        args: ["-y", "conversation-memory-mcp"],
      }),
    ]);
    assert.deepEqual(command[2], {
      stdio: "ignore",
      windowsHide: true,
    });
  });

  it("rejects project scope for OpenClaw", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-"));
    assert.throws(
      () => install({ cwd, agent: "openclaw", scope: "project" }),
      /OpenClaw administra sus servidores MCP/,
    );
  });

  it("installs Hermes MCP through its CLI in global scope", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-"));
    const homeDir = mkdtempSync(join(tmpdir(), "conversation-memory-hermes-home-"));
    const configFile = join(homeDir, ".hermes", "config.yaml");
    let command;

    const result = install({
      cwd,
      agent: "hermes",
      scope: "global",
      homeDir,
      commandRunner: (...args) => {
        command = args;
      },
    });

    assert.equal(result.agent, "hermes");
    assert.equal(result.mcp.supported, true);
    assert.equal(result.mcp.scope, "global");
    assert.equal(result.mcp.file, configFile);
    assert.equal(command[0], process.platform === "win32" ? "hermes.exe" : "hermes");
    assert.deepEqual(command[1], [
      "mcp",
      "add",
      "conversation-memory",
      "--command",
      "npx",
      "--args",
      "-y",
      "conversation-memory-mcp",
    ]);
    assert.deepEqual(command[2], {
      stdio: "ignore",
      windowsHide: true,
    });
  });

  it("rejects project scope for Hermes", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-"));
    assert.throws(
      () => install({ cwd, agent: "hermes", scope: "project" }),
      /Hermes administra sus servidores MCP/,
    );
  });

  it("detects existing agent files", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-"));
    writeFileSync(join(cwd, "CLAUDE.md"), "# Project\n");
    assert.equal(detectAgent(cwd), "claude");
  });

  it("detects OpenCode from its installed project config", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-"));
    mkdirSync(join(cwd, ".opencode"), { recursive: true });
    writeFileSync(join(cwd, ".opencode", "opencode.json"), "{}");
    assert.equal(detectAgent(cwd), "opencode");
  });

  it("auto-detects an existing agent during install", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-"));
    mkdirSync(join(cwd, ".cursor"), { recursive: true });
    writeFileSync(join(cwd, ".cursor", "mcp.json"), JSON.stringify({
      mcpServers: { other: { command: "other" } }
    }));
    const result = install({ cwd });
    assert.equal(result.agent, "cursor");
    assert.equal(result.mcp.changed, true);
  });

  it("keeps existing Cursor MCP servers", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-"));
    mkdirSync(join(cwd, ".cursor"), { recursive: true });
    writeFileSync(join(cwd, ".cursor", "mcp.json"), JSON.stringify({
      mcpServers: { other: { command: "other" } }
    }));
    install({ cwd, agent: "cursor" });
    const config = JSON.parse(readFileSync(join(cwd, ".cursor", "mcp.json"), "utf8"));
    assert.equal(config.mcpServers.other.command, "other");
    assert.equal(config.mcpServers["conversation-memory"].command, "npx");
  });
});
