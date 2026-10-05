const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { dirname, join } = require("node:path");
const { install, detectAgent } = require("../src/installer");

describe("installer", () => {
  it("installs policy and MCP for OpenCode", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-"));
    const result = install({ cwd, agent: "opencode" });
    assert.equal(result.agent, "opencode");
    const config = JSON.parse(readFileSync(join(cwd, ".opencode", "opencode.json"), "utf8"));
    assert.deepEqual(config.mcp["conversation-memory"], {
      type: "local",
      command: ["npx", "-y", "conversation-memory-mcp"],
    });
    assert.equal(config.mcp.servers, undefined);
  });

  it("installs Kilo Code MCP in its project config format", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-"));
    const result = install({ cwd, agent: "kilocode" });
    const config = JSON.parse(readFileSync(join(cwd, ".kilo", "kilo.jsonc"), "utf8"));
    const server = config.mcp["conversation-memory"];

    assert.equal(result.mcp.file, join(cwd, ".kilo", "kilo.jsonc"));
    assert.equal(server.type, "local");
    assert.equal(server.enabled, true);
    assert.deepEqual(server.command, process.platform === "win32"
      ? ["cmd", "/c", "npx", "-y", "conversation-memory-mcp"]
      : ["npx", "-y", "conversation-memory-mcp"]);
  });

  it("installs project MCP config for Claude and Cursor by default", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-"));
    install({ cwd, agent: "claude" });
    install({ cwd, agent: "cursor" });
    assert.ok(existsSync(join(cwd, ".mcp.json")));
    assert.ok(existsSync(join(cwd, ".cursor", "mcp.json")));
  });

  it("installs Claude MCP globally when requested", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-"));
    const homeDir = mkdtempSync(join(tmpdir(), "conversation-memory-claude-home-"));
    const result = install({ cwd, agent: "claude", scope: "global", homeDir });

    assert.equal(result.mcp.scope, "global");
    assert.equal(result.mcp.file, join(homeDir, ".claude.json"));
    assert.ok(!existsSync(join(cwd, ".mcp.json")));
    const config = JSON.parse(readFileSync(result.mcp.file, "utf8"));
    assert.equal(config.mcpServers["conversation-memory"].command, "npx");
  });

  it("installs Cursor MCP globally when requested", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-"));
    const homeDir = mkdtempSync(join(tmpdir(), "conversation-memory-cursor-home-"));
    const result = install({ cwd, agent: "cursor", scope: "global", homeDir });

    assert.equal(result.mcp.scope, "global");
    assert.equal(result.mcp.file, join(homeDir, ".cursor", "mcp.json"));
    assert.ok(!existsSync(join(cwd, ".cursor", "mcp.json")));
    const config = JSON.parse(readFileSync(result.mcp.file, "utf8"));
    assert.equal(config.mcpServers["conversation-memory"].command, "npx");
  });

  it("defaults global-only agents to global scope", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-"));
    const homeDir = mkdtempSync(join(tmpdir(), "conversation-memory-openclaw-home-"));
    let command;

    const result = install({
      cwd,
      agent: "openclaw",
      homeDir,
      commandRunner: (...args) => {
        command = args;
      },
    });

    assert.equal(result.mcp.scope, "global");
    assert.equal(command[1][0], "mcp");
    assert.equal(command[1][1], "set");
  });

  it("installs GitHub Copilot CLI MCP in project scope by default", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-"));
    const result = install({ cwd, agent: "github-copilot" });

    assert.equal(result.mcp.scope, "project");
    assert.equal(result.mcp.file, join(cwd, ".mcp.json"));
    const config = JSON.parse(readFileSync(result.mcp.file, "utf8"));
    assert.equal(config.mcpServers["conversation-memory"].command, "npx");
    assert.deepEqual(config.mcpServers["conversation-memory"].args, ["-y", "conversation-memory-mcp"]);
  });

  it("installs GitHub Copilot CLI MCP globally through its CLI", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-"));
    const homeDir = mkdtempSync(join(tmpdir(), "conversation-memory-copilot-home-"));
    let command;

    const result = install({
      cwd,
      agent: "github-copilot",
      scope: "global",
      homeDir,
      commandRunner: (...args) => {
        command = args;
      },
    });

    assert.equal(result.agent, "github-copilot");
    assert.equal(result.mcp.supported, true);
    assert.equal(result.mcp.scope, "global");
    assert.equal(result.mcp.file, join(homeDir, ".copilot", "mcp-config.json"));
    assert.deepEqual(command[1], [
      "mcp",
      "add",
      "conversation-memory",
      "--",
      "npx",
      "-y",
      "conversation-memory-mcp",
    ]);
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

  it("installs Qwen Code MCP in project scope by default", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-"));
    const result = install({ cwd, agent: "qwen-code" });

    assert.equal(result.mcp.scope, "project");
    assert.equal(result.mcp.file, join(cwd, ".qwen", "settings.json"));
    const config = JSON.parse(readFileSync(result.mcp.file, "utf8"));
    assert.equal(config.mcpServers["conversation-memory"].command, "npx");
    assert.deepEqual(config.mcpServers["conversation-memory"].args, ["-y", "conversation-memory-mcp"]);
  });

  it("installs Qwen Code MCP globally when requested", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-"));
    const homeDir = mkdtempSync(join(tmpdir(), "conversation-memory-qwen-home-"));
    const result = install({ cwd, agent: "qwen-code", scope: "global", homeDir });

    assert.equal(result.mcp.scope, "global");
    assert.equal(result.mcp.file, join(homeDir, ".qwen", "settings.json"));
    assert.ok(!existsSync(join(cwd, ".qwen", "settings.json")));
  });

  it("installs Windsurf MCP globally by default", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-"));
    const homeDir = mkdtempSync(join(tmpdir(), "conversation-memory-windsurf-home-"));
    const result = install({ cwd, agent: "windsurf", homeDir });

    assert.equal(result.mcp.scope, "global");
    assert.equal(result.mcp.file, join(homeDir, ".codeium", "windsurf", "mcp_config.json"));
    assert.ok(!existsSync(join(cwd, ".windsurf", "mcp_config.json")));
    const config = JSON.parse(readFileSync(result.mcp.file, "utf8"));
    assert.equal(config.mcpServers["conversation-memory"].command, "npx");
  });

  it("rejects project scope for Windsurf", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-"));
    assert.throws(
      () => install({ cwd, agent: "windsurf", scope: "project" }),
      /Windsurf administra sus servidores MCP/,
    );
  });

  it("installs Antigravity MCP in project scope by default", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-"));
    const result = install({ cwd, agent: "antigravity" });

    assert.equal(result.mcp.scope, "project");
    assert.equal(result.mcp.file, join(cwd, ".agents", "mcp_config.json"));
    const config = JSON.parse(readFileSync(result.mcp.file, "utf8"));
    assert.equal(config.mcpServers["conversation-memory"].command, "npx");
  });

  it("installs Antigravity MCP globally when requested", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-"));
    const homeDir = mkdtempSync(join(tmpdir(), "conversation-memory-antigravity-home-"));
    const result = install({ cwd, agent: "antigravity", scope: "global", homeDir });

    assert.equal(result.mcp.scope, "global");
    assert.equal(result.mcp.file, join(homeDir, ".gemini", "config", "mcp_config.json"));
    assert.ok(!existsSync(join(cwd, ".agents", "mcp_config.json")));
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

  it("auto-detects each supported project marker and writes that agent's config", () => {
    const cases = [
      {
        agent: "opencode",
        marker: ".opencode/opencode.json",
        markerIsFile: true,
        config: ".opencode/opencode.json",
        assertConfig: (cwd) => {
          const config = JSON.parse(readFileSync(join(cwd, ".opencode", "opencode.json"), "utf8"));
          assert.equal(config.mcp["conversation-memory"].type, "local");
          assert.equal(config.mcp.servers, undefined);
        },
      },
      {
        agent: "opencode",
        marker: "opencode.json",
        markerIsFile: true,
        config: ".opencode/opencode.json",
        assertConfig: (cwd) => {
          const config = JSON.parse(readFileSync(join(cwd, ".opencode", "opencode.json"), "utf8"));
          assert.equal(config.mcp["conversation-memory"].type, "local");
          assert.equal(config.mcp.servers, undefined);
        },
      },
      {
        agent: "codex",
        marker: ".codex",
        config: ".codex/config.toml",
        assertConfig: (cwd) => {
          assert.match(readFileSync(join(cwd, ".codex", "config.toml"), "utf8"), /\[mcp_servers\.conversation-memory\]/);
        },
      },
      {
        agent: "claude",
        marker: "CLAUDE.md",
        markerIsFile: true,
        config: ".mcp.json",
        assertConfig: (cwd) => {
          const config = JSON.parse(readFileSync(join(cwd, ".mcp.json"), "utf8"));
          assert.equal(config.mcpServers["conversation-memory"].command, "npx");
        },
      },
      {
        agent: "cursor",
        marker: ".cursor",
        config: ".cursor/mcp.json",
        assertConfig: (cwd) => {
          const config = JSON.parse(readFileSync(join(cwd, ".cursor", "mcp.json"), "utf8"));
          assert.equal(config.mcpServers["conversation-memory"].command, "npx");
        },
      },
      {
        agent: "kimi",
        marker: ".kimi-code",
        config: ".kimi-code/mcp.json",
        assertConfig: (cwd) => {
          const config = JSON.parse(readFileSync(join(cwd, ".kimi-code", "mcp.json"), "utf8"));
          assert.equal(config.mcpServers["conversation-memory"].command, "npx");
        },
      },
      {
        agent: "kiro-ide",
        marker: ".kiro",
        config: ".kiro/settings/mcp.json",
        assertConfig: (cwd) => {
          const config = JSON.parse(readFileSync(join(cwd, ".kiro", "settings", "mcp.json"), "utf8"));
          assert.equal(config.mcpServers["conversation-memory"].command, "npx");
        },
      },
      {
        agent: "copilot",
        marker: ".github/copilot-instructions.md",
        markerIsFile: true,
        config: ".vscode/mcp.json",
        assertConfig: (cwd) => {
          const config = JSON.parse(readFileSync(join(cwd, ".vscode", "mcp.json"), "utf8"));
          assert.equal(config.servers["conversation-memory"].type, "stdio");
        },
      },
    ];

    for (const testCase of cases) {
      const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-"));
      const marker = join(cwd, testCase.marker);
      if (testCase.markerIsFile) {
        mkdirSync(dirname(marker), { recursive: true });
        writeFileSync(marker, "{}");
      } else {
        mkdirSync(marker, { recursive: true });
      }

      const result = install({ cwd });
      assert.equal(result.agent, testCase.agent, `detected ${testCase.agent}`);
      assert.equal(result.mcp.file, join(cwd, testCase.config), `${testCase.agent} config path`);
      testCase.assertConfig(cwd);
    }
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
