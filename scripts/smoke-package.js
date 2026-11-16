// Validate the packed candidate, never an unrelated version from npm @latest.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { sync: spawn } = require("cross-spawn");
const { setTimeout: delay } = require("node:timers/promises");
const root = path.resolve(__dirname, "..");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "cm-package-"));
function command(executable, args, cwd, timeout = 180000) {
  const result = spawn(executable, args, { cwd, timeout, windowsHide: true, encoding: "utf8", env: process.env });
  if (result.error || result.status !== 0) throw new Error(`${executable} failed: ${result.error?.message || result.stderr}`);
  return result.stdout;
}
(async () => {
  const pack = JSON.parse(command("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", work], root))[0];
  assert.ok(pack.files.some(file => file.path === "plugins/opencode-v2.mjs"));
  assert.ok(pack.files.some(file => file.path === "src/hooks/capture.js"));
  const prefix = path.join(work, "installed");
  command("npm", ["install", "--prefix", prefix, "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund", path.join(work, path.basename(pack.filename))], work);
  const candidate = path.join(prefix, "node_modules", "conversation-memory-mcp");
  const cli = path.join(candidate, "src", "cli.js");
  assert.match(command(process.execPath, [cli, "--help"], work), /--opencode-version/);
  const { install } = require(path.join(candidate, "src", "installer"));
  const { installExtendedHooks } = require(path.join(candidate, "src/installer/extendedHooks"));
  for (const agent of ["codex", "github-copilot", "qwen-code", "kimi", "hermes", "windsurf", "pi", "kilocode", "openclaw", "trae-cn"]) {
    const cwd = path.join(work, `extended-${agent}`), homeDir = path.join(work, `home-${agent}`);
    fs.mkdirSync(cwd, { recursive: true }); fs.mkdirSync(homeDir, { recursive: true });
    const result = installExtendedHooks({ cwd, homeDir, agent });
    assert.equal(result.mode, "automatic"); assert.ok(fs.existsSync(result.file));
    const repeated = installExtendedHooks({ cwd, homeDir, agent }); assert.equal(repeated.changed, false);
    if (["pi", "kilocode", "openclaw"].includes(agent)) {
      const directory = agent === "pi" ? path.dirname(result.file) : agent === "kilocode" ? path.join(cwd, ".kilo/conversation-memory-capture") : path.join(homeDir, ".openclaw/extensions/conversation-memory-capture");
      const loaded = await import(pathToFileURL(path.join(directory, "index.mjs")).href);
      assert.ok(loaded.default); assert.ok(!fs.readFileSync(path.join(directory, "capture-bridge.mjs"), "utf8").includes("__VERSION__"));
    }
  }
  console.log("Packed candidate: extended hooks/plugins install idempotently and plugin entrypoints load.");
  const mcpModule = require.resolve("@modelcontextprotocol/sdk/server/mcp.js", { paths: [candidate] });
  const stdioModule = require.resolve("@modelcontextprotocol/sdk/server/stdio.js", { paths: [candidate] });
  const zodModule = require.resolve("zod", { paths: [candidate] });
  const fixture = path.join(work, "recording-server.cjs");
  fs.writeFileSync(fixture, `const {McpServer}=require(${JSON.stringify(mcpModule)});
const {StdioServerTransport}=require(${JSON.stringify(stdioModule)});
const {z}=require(${JSON.stringify(zodModule)});
const fs=require('node:fs');
const server=new McpServer({name:'capture-fixture',version:'1.0.0'});
server.tool('saveMessage',{sessionId:z.string(),project:z.string(),projectPath:z.string().optional(),role:z.string(),content:z.string(),sourceMessageId:z.string(),relatedMessageId:z.string().optional(),agentId:z.string().optional()}, async args=>{
fs.appendFileSync(process.argv[2],JSON.stringify(args)+'\\n');
return {content:[{type:'text',text:'ID: saved-'+args.sourceMessageId}]};
});
server.connect(new StdioServerTransport());`);
  process.env.OPENCODE_CONFIG_DIR = path.join(work, "global-config");
  delete process.env.OPENCODE_CONFIG; delete process.env.CONVERSATION_MEMORY_URL; delete process.env.CONVERSATION_MEMORY_TOKEN;
  for (const version of ["1.19.5", "2.2.6"]) {
    const cwd = path.join(work, `project-v${version[0]}`);
    fs.mkdirSync(cwd, { recursive: true });
    const result = install({ cwd, homeDir: work, agent: "opencode", opencodeVersion: version });
    const log = path.join(cwd, "saved.jsonl");
    const config = JSON.parse(fs.readFileSync(result.mcp.file, "utf8"));
    config.mcp["conversation-memory"].command = [process.execPath, fixture, log];
    fs.writeFileSync(result.mcp.file, JSON.stringify(config));
    const loaded = (await import(pathToFileURL(path.join(result.mcp.plugin.directory, "entry.mjs")).href)).default;
    let cleanup;
    if (version.startsWith("1")) {
      const hooks = await loaded({ directory: cwd, project: { id: "project" }, client: {
        app: { log: async () => {} }, session: {
          get: async () => ({ data: { directory: cwd } }),
          messages: async () => ({ data: [
            { info: { id: "u", role: "user" }, parts: [{ type: "text", text: "Remember this decision" }] },
            { info: { id: "a", role: "assistant", parentID: "u" }, parts: [{ type: "text", text: "Decision saved" }] },
          ] }),
        },
      } });
      const event = { event: { type: "session.idle", properties: { sessionID: "fixture" } } };
      await hooks.event(event); await hooks.event(event); cleanup = hooks.dispose;
    } else {
      cleanup = await loaded.setup({ location: { directory: cwd, project: { id: "project", canonical: cwd } },
        session: { get: async () => ({ location: { directory: cwd } }), context: async () => [
          { id: "u", type: "user", text: "Remember this decision" },
          { id: "a", type: "assistant", content: [{ type: "text", text: "Decision saved" }], agent: "build" },
        ] },
        tool: { hook: async () => ({ dispose: async () => {} }) },
        event: { subscribe: async function* ({ types }) { assert.ok(types.includes("session.execution.succeeded")); yield { type: "session.execution.succeeded", data: { sessionID: "fixture" } }; yield { type: "session.execution.succeeded", data: { sessionID: "fixture" } }; } },
      });
    }
    for (let count = 0; count < 100; count++) {
      if (fs.existsSync(log) && fs.readFileSync(log, "utf8").split("\n").filter(Boolean).length === 2) break;
      await delay(50);
    }
    await cleanup();
    const rows = fs.readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line));
    assert.equal(rows.length, 2); assert.equal(rows[1].relatedMessageId, "saved-u");
    assert.equal(rows[0].project, `project-v${version[0]}`);
    console.log(`Packed candidate ${version}: persistent plugin loaded, saved/linked two messages, deduplicated and unloaded.`);
  }
  const failure = spawn(process.execPath, [cli, "capture", "--agent", "claude"], { cwd: work, input: "bad JSON", encoding: "utf8", windowsHide: true });
  assert.equal(failure.status, 0); assert.deepEqual(JSON.parse(failure.stdout), {});
  console.log(`Package smoke passed (${pack.filename}); isolated files: ${work}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
