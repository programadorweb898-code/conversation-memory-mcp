const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { installMcpConfig } = require("../src/installer/mcpConfig");

describe("installer MCP config", () => {
  it("writes VS Code workspace MCP config in the documented format", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "conversation-memory-mcp-"));

    const result = installMcpConfig({ cwd, agent: "copilot" });
    const config = JSON.parse(
      fs.readFileSync(path.join(cwd, ".vscode", "mcp.json"), "utf8"),
    );

    assert.equal(result.supported, true);
    assert.equal(result.file, path.join(cwd, ".vscode", "mcp.json"));
    assert.deepEqual(config.servers["conversation-memory"], {
      type: "stdio",
      command: "npx",
      args: ["-y", "conversation-memory-mcp"],
    });
    assert.equal(config.mcpServers, undefined);
  });

  it("preserves unrelated VS Code MCP servers", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "conversation-memory-mcp-"));
    fs.mkdirSync(path.join(cwd, ".vscode"), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, ".vscode", "mcp.json"),
      JSON.stringify({
        servers: {
          playwright: {
            command: "npx",
            args: ["-y", "@playwright/mcp"],
          },
        },
      }),
    );

    installMcpConfig({ cwd, agent: "copilot" });
    const config = JSON.parse(
      fs.readFileSync(path.join(cwd, ".vscode", "mcp.json"), "utf8"),
    );

    assert.ok(config.servers.playwright);
    assert.ok(config.servers["conversation-memory"]);
  });
});
