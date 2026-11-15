const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const TOML = require("@iarna/toml");
const { parse } = require("jsonc-parser");
const { install } = require("../src/installer");
const { detectOpenCodeVersion } = require("../src/installer/opencode");
const { findMcpConfig } = require("../plugins/opencode-config");
const temp = () => mkdtempSync(join(tmpdir(), "cm-installer-"));
function runner(calls = [], version = "1.19.5") {
  return (command, args, options) => {
    calls.push({ command, args, options });
    if (command === "opencode") return { status: 0, stdout: version };
    for (const name of ["@modelcontextprotocol/sdk", "jsonc-parser"]) {
      const directory = join(options.cwd, "node_modules", name);
      mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, "package.json"), "{}");
    }
    return { status: 0 };
  };
}
describe("version-aware OpenCode installer", () => {
  for (const version of ["1.19.5", "2.2.6"]) {
    it(`installs persistent capture, preserves JSONC and is idempotent for ${version}`, () => {
      const cwd = temp(), homeDir = temp(), calls = [];
      const file = join(cwd, "opencode.jsonc");
      writeFileSync(file, '{\n// keep me\n"model":"user-model", "mcp":{"other":{"command":["other"]}},\n}');
      const commandRunner = runner(calls, version);
      const first = install({ cwd, homeDir, agent: "opencode", commandRunner });
      assert.equal(first.mcp.capture, "automatic");
      assert.equal(first.mcp.file, file);
      const text = readFileSync(file, "utf8"), config = parse(text);
      assert.match(text, /keep me/); assert.equal(config.model, "user-model");
      assert.deepEqual(config.mcp.other.command, ["other"]);
      const entry = config[version.startsWith("1") ? "plugin" : "plugins"][0];
      const directory = first.mcp.plugin.directory;
      assert.equal(entry, pathToFileURL(version.startsWith("1") ? join(directory, "entry.mjs") : directory).href);
      assert.ok(existsSync(join(directory, "opencode-v2.mjs")));
      const second = install({ cwd, homeDir, agent: "opencode", commandRunner });
      assert.equal(second.mcp.changed, false);
      assert.equal(calls.filter(call => call.command === "npm").length, 1);
      assert.equal(readFileSync(file, "utf8"), text);
    });
  }
  it("switches the managed entrypoint between API generations without duplicate capture", () => {
    const cwd = temp(), homeDir = temp(), commandRunner = runner();
    const first = install({ cwd, homeDir, agent: "opencode", opencodeVersion: "1.19.5", commandRunner });
    const file = first.mcp.file;
    const old = JSON.parse(readFileSync(file)); old.plugin.unshift("unrelated-plugin"); writeFileSync(file, JSON.stringify(old));
    const second = install({ cwd, homeDir, agent: "opencode", opencodeVersion: "2.2.6", commandRunner });
    const config = JSON.parse(readFileSync(file));
    assert.deepEqual(config.plugin, ["unrelated-plugin"]);
    assert.equal(config.plugins.length, 1);
    assert.match(readFileSync(join(second.mcp.plugin.directory, "entry.mjs"), "utf8"), /opencode-v2/);
  });
  it("does not write a policy or config when the version is unknown or unsupported", () => {
    for (const version of ["0.9.0", "3.0.0", "2.3.0-beta.1", "unknown"]) {
      const cwd = temp();
      assert.throws(() => install({ cwd, agent: "opencode", opencodeVersion: version, commandRunner: runner() }), /Version/);
      assert.equal(existsSync(join(cwd, "AGENTS.md")), false);
      assert.equal(existsSync(join(cwd, ".opencode")), false);
    }
    assert.throws(() => detectOpenCodeVersion({ cwd: temp(), commandRunner: () => ({ status: 1 }) }), /--opencode-version/);
  });
  it("does not activate capture when dependency installation fails", () => {
    const cwd = temp();
    assert.throws(() => install({ cwd, agent: "opencode", opencodeVersion: "1.19.5", commandRunner: () => ({ status: 1, stderr: "network failed" }) }), /network failed/);
    assert.equal(existsSync(join(cwd, ".opencode", "opencode.json")), false);
    assert.equal(existsSync(join(cwd, "AGENTS.md")), false);
  });
  it("rejects an existing manual capture plugin rather than activating two copies", () => {
    const cwd = temp(); mkdirSync(join(cwd, ".opencode", "plugins"), { recursive: true });
    writeFileSync(join(cwd, ".opencode", "plugins", "conversation-memory.ts"), "manual plugin");
    assert.throws(() => install({ cwd, agent: "opencode", opencodeVersion: "1.19.5", commandRunner: runner() }), /duplicados/);
  });
  it("reads project JSONC before global configuration and honors disabled servers", () => {
    const cwd = temp(), configDir = temp();
    writeFileSync(join(configDir, "opencode.json"), JSON.stringify({ mcp: { "conversation-memory": { command: ["global"] } } }));
    mkdirSync(join(cwd, ".opencode"));
    const file = join(cwd, ".opencode", "opencode.jsonc");
    writeFileSync(file, '{// local\n"mcp":{"conversation-memory":{"command":["project"]}},}');
    assert.equal(findMcpConfig(cwd, { configDir }).command, "project");
    writeFileSync(file, '{"mcp":{"conversation-memory":{"enabled":false}}}');
    assert.equal(findMcpConfig(cwd, { configDir }), null);
  });
});
describe("existing configuration regression checks", () => {
  it("updates Codex repeatedly without duplicate keys and preserves custom options and other servers", () => {
    const cwd = temp(); mkdirSync(join(cwd, ".codex"));
    const file = join(cwd, ".codex", "config.toml");
    writeFileSync(file, '# keep root comment\nmodel="user-model"\n[mcp_servers.conversation-memory]\ncommand="old"\nargs=["old"]\nstartup_timeout_sec=70\n[mcp_servers.conversation-memory.env]\nKEEP="yes"\n# other comment\n[mcp_servers.other]\ncommand="other"\n');
    install({ cwd, agent: "codex" }); const text = readFileSync(file, "utf8");
    const config = TOML.parse(text);
    assert.equal(config.model, "user-model"); assert.equal(config.mcp_servers.other.command, "other");
    assert.equal(config.mcp_servers["conversation-memory"].startup_timeout_sec, 70);
    assert.equal(config.mcp_servers["conversation-memory"].env.KEEP, "yes");
    assert.match(text, /keep root comment/);
    install({ cwd, agent: "codex" }); assert.equal(readFileSync(file, "utf8"), text);
  });
  it("preserves a Windows UTF-8 BOM while updating JSONC", () => {
    const cwd = temp(); mkdirSync(join(cwd, ".kilo")); const file = join(cwd, ".kilo", "kilo.jsonc");
    writeFileSync(file, '\uFEFF{// keep BOM\n"mcp":{},}');
    install({ cwd, agent: "kilocode" }); const text = readFileSync(file, "utf8");
    assert.ok(text.startsWith("\uFEFF")); assert.match(text, /keep BOM/);
    assert.ok(parse(text.slice(1)).mcp["conversation-memory"]);
  });
  it("updates Kilo JSONC without deleting comments or existing MCP servers", () => {
    const cwd = temp(); mkdirSync(join(cwd, ".kilo")); const file = join(cwd, ".kilo", "kilo.jsonc");
    writeFileSync(file, '{// keep comment\n"mcp":{"other":{"command":["other"],}},}');
    install({ cwd, agent: "kilocode" }); const text = readFileSync(file, "utf8");
    assert.match(text, /keep comment/); assert.deepEqual(parse(text).mcp.other.command, ["other"]);
  });
});
