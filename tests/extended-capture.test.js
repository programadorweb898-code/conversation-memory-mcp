const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, chmodSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { tmpdir } = require("node:os");
const { EventEmitter } = require("node:events");
const { spawnSync } = require("node:child_process");
const TOML = require("@iarna/toml");
const YAML = require("yaml");
const { captureTurn, persistMessages } = require("../src/hooks/capture");
const { installExtendedHooks } = require("../src/installer/extendedHooks");
const { captureCommand } = require("../src/installer/captureLauncher");
const { parseRows, extendedMessages } = require("../src/hooks/extended");
const { enqueue, drain } = require("../src/hooks/outbox");
const temp = () => mkdtempSync(join(tmpdir(), "cm-extended-"));
function store() {
  const rows = new Map();
  return { rows, saveMessage: async args => {
    const key = args.sessionId + args.sourceMessageId;
    if (!rows.has(key)) rows.set(key, { ...args, id: `id-${rows.size}` });
    return { success: true, messageId: rows.get(key).id };
  } };
}
describe("extended capture contracts", () => {
  for (const agent of ["qwen-code", "github-copilot", "windsurf", "kimi"]) {
    it(`captures ${agent} visible transcript messages, deduplicates and links multiple turns`, async () => {
      const cwd = temp(), file = join(cwd, "transcript.jsonl"), db = store();
      const records = agent === "qwen-code" ? [
        { uuid: "u", type: "user", message: { role: "user", content: [{ type: "text", text: "Question" }] } },
        { uuid: "t", type: "tool_result", message: { role: "user", content: "private tool result" } },
        { uuid: "a", type: "assistant", message: { role: "assistant", content: [{ type: "thinking", text: "secret" }, { type: "text", text: "Answer" }] } },
      ] : agent === "github-copilot" ? [
        { id: "u", type: "user.message", data: { content: "Question" } },
        { id: "t", type: "tool.execution_complete", data: { content: "secret" } },
        { id: "a", type: "assistant.message", data: { content: "Answer", reasoningText: "secret" } },
      ] : agent === "windsurf" ? [
        { type: "user_input", status: "done", user_input: { user_response: "Question" } },
        { type: "code_action", status: "done", code_action: { new_content: "secret" } },
        { type: "planner_response", status: "done", planner_response: { response: "Answer" } },
      ] : [{ role: "_system_prompt", content: "secret" }, { role: "user", content: "Question" }, { role: "assistant", content: [{ type: "think", text: "secret" }, { type: "text", text: "Answer" }] }];
      writeFileSync(file, records.map(r => JSON.stringify(r)).join("\n"));
      const input = { session_id: "s", cwd, transcript_path: file };
      await captureTurn(agent, input, db); await captureTurn(agent, input, db);
      assert.equal(db.rows.size, 2);
      const [u, a] = [...db.rows.values()]; assert.equal(a.relatedMessageId, u.id); assert.equal(a.content, "Answer");
      assert.equal(u.projectPath, cwd); assert.equal(u.agentId, agent);
    });
  }
  for (const agent of ["codex", "trae"]) it(`pairs ${agent} native prompt/Stop payloads and keeps identical consecutive prompts distinct`, async () => {
    const cwd = temp(), stateDir = join(cwd, "state"), db = store();
    const base = { session_id: "s", cwd, ...(agent === "codex" ? { turn_id: "turn1" } : {}) };
    await captureTurn(agent, { ...base, hook_event_name: "UserPromptSubmit", prompt: "Question" }, { ...db, stateDir });
    const stop = { ...base, hook_event_name: "Stop", last_assistant_message: "Answer" };
    await captureTurn(agent, stop, { ...db, stateDir }); await captureTurn(agent, stop, { ...db, stateDir });
    assert.equal(db.rows.size, 2); assert.equal([...db.rows.values()][1].relatedMessageId, [...db.rows.values()][0].id);
    await captureTurn(agent, { ...base, ...(agent === "codex" ? { turn_id: "turn2" } : {}), hook_event_name: "UserPromptSubmit", prompt: "Question" }, { ...db, stateDir });
    assert.equal(db.rows.size, 3);
  });
  it("captures Hermes shell-hook extra fields with stable turn identity", async () => {
    const db = store(), cwd = temp();
    const input = { session_id: "s", cwd, extra: { turn_id: "t", user_message: "Question", assistant_response: "Answer", conversation_history: "secret" } };
    await captureTurn("hermes", input, db); await captureTurn("hermes", input, db);
    assert.equal(db.rows.size, 2); assert.equal([...db.rows.values()][1].content, "Answer");
    await assert.rejects(() => captureTurn("hermes", { ...input, extra: {} }, db), /turn_id/);
  });
  it("fails visibly for unknown transcript schemas rather than treating them as saved", () => {
    assert.throws(() => parseRows("github-copilot", '{"type":"unknown"}'), /Unsupported/);
    assert.throws(() => parseRows("qwen-code", '{"type":"assistant","content":"Answer"}'), /identity/);
  });
  it("finds the exact Kimi session and never picks another session's transcript", async () => {
    const homeDir = temp(), cwd = temp();
    const directory = join(homeDir, ".kimi/sessions/project-hash/sess"); mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "context.jsonl"), '{"role":"user","content":"Question"}\n{"role":"assistant","content":"Answer"}');
    const result = await extendedMessages("kimi", { session_id: "sess", cwd }, { homeDir });
    assert.equal(result.messages.length, 2);
    await assert.rejects(() => extendedMessages("kimi", { session_id: "other", cwd }, { homeDir }), /unavailable/);
  });
  it("uses the same Kimi home as the installer after a legacy-directory migration", async () => {
    const homeDir = temp(), cwd = temp();
    for (const base of [".kimi", ".kimi-code"]) {
      const dir = join(homeDir, base, "sessions/project-hash/sess"); mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "context.jsonl"), JSON.stringify({ role: "user", content: base === ".kimi" ? "Current question" : "Stale migrated history" }));
    }
    writeFileSync(join(homeDir, ".kimi/config.toml"), "# current home\n");
    const result = await extendedMessages("kimi", { session_id: "sess", cwd }, { homeDir });
    assert.equal(result.messages[0].content, "Current question");
  });
  it("reads Kimi append-only wire records without leaking thinking or tool output", () => {
    const record = (type, payload, i) => ({ timestamp: i, message: { type, payload } });
    const source = [record("TurnBegin", { user_input: "Question" }, 1), record("StepBegin", { n: 1 }, 2),
      record("ContentPart", { type: "think", think: "secret" }, 3), record("ContentPart", { type: "text", text: "First " }, 4),
      record("ContentPart", { type: "text", text: "answer" }, 5), record("ToolCall", { content: "secret" }, 6),
      record("TurnEnd", {}, 7)].map(r => JSON.stringify(r)).join("\n");
    const rows = parseRows("kimi", source); assert.equal(rows.length, 2); assert.equal(rows[1].content, "First answer");
    assert.deepEqual(parseRows("kimi", source), rows);
  });
  it("reads Qwen model-role parts while excluding internal user-like records", () => {
    const source = [
      { uuid: "u", type: "user", provenance: "real_user", systemPayload: { displayText: "Original prompt" }, message: { role: "user", parts: [{ text: "Injected context" }] } },
      { uuid: "internal", type: "user", subtype: "agent_message", message: { role: "user", parts: [{ text: "Internal" }] } },
      { uuid: "a", type: "assistant", message: { role: "model", parts: [{ text: "secret", thought: true }, { text: "Answer" }] } },
    ].map(r => JSON.stringify(r)).join("\n");
    assert.deepEqual(parseRows("qwen-code", source).map(m => m.content), ["Original prompt", "Answer"]);
  });
  it("excludes Copilot checkpoints/subagent/hidden records and honors the originating user ID", async () => {
    const source = [
      { id: "event-u", type: "user.message", data: { messageId: "logical-u", content: "Question" } },
      { id: "event-steer", type: "user.message", data: { messageId: "steer", content: "Steering" } },
      { id: "child", type: "assistant.message", data: { parentToolCallId: "tool", content: "Internal" } },
      { id: "checkpoint", checkpoint: true, type: "user.message", data: { content: "Replayed" } },
      { id: "hidden", type: "user.message", data: { source: "skill-secret", content: "Hidden" } },
      { id: "event-a", type: "assistant.message", data: { messageId: "logical-a", originatingMessageId: "logical-u", content: "Answer" } },
    ].map(r => JSON.stringify(r)).join("\n");
    const messages = parseRows("github-copilot", source); assert.equal(messages.length, 3);
    const db = store(); await persistMessages({ scoped: { sessionId: "s", agentId: "github-copilot" }, messages }, db.saveMessage);
    const [u, , a] = [...db.rows.values()]; assert.equal(a.relatedMessageId, u.id);
  });
});
describe("extended installer", () => {
  for (const agent of ["codex", "qwen-code", "github-copilot", "kimi", "windsurf", "hermes", "pi", "kilocode", "openclaw"]) {
    it(`installs ${agent} idempotently using an isolated home`, () => {
      const cwd = temp(), homeDir = temp();
      const options = { cwd, homeDir, agent, scope: ["hermes", "openclaw", "windsurf"].includes(agent) ? "global" : "project" };
      const first = installExtendedHooks(options); assert.equal(first.mode, "automatic");
      const before = readFileSync(first.file, "utf8");
      const second = installExtendedHooks(options);
      assert.equal(readFileSync(second.file, "utf8"), before); assert.equal(second.changed, false);
      assert.ok(first.file.startsWith(cwd) || first.file.startsWith(homeDir));
    });
  }
  it("preserves Hermes YAML comments, unrelated hooks and authentication settings", () => {
    const homeDir = temp(), cwd = temp(), file = join(homeDir, ".hermes/config.yaml"); mkdirSync(join(homeDir, ".hermes"));
    writeFileSync(file, '# preserve\nmodel: test-model\nhooks:\n  post_llm_call:\n    - command: other-hook\n');
    installExtendedHooks({ homeDir, cwd, agent: "hermes", scope: "global" });
    const text = readFileSync(file, "utf8"), value = YAML.parse(text);
    assert.match(text, /# preserve/); assert.equal(value.model, "test-model"); assert.equal(value.hooks.post_llm_call[0].command, "other-hook");
  });
  it("preserves Kimi TOML comments and other hook rules", () => {
    const homeDir = temp(), cwd = temp(), file = join(homeDir, ".kimi/config.toml"); mkdirSync(join(homeDir, ".kimi"));
    writeFileSync(file, '# preserve\ndefault_model="test"\n[[hooks]]\nevent="Notification"\ncommand="other"\n');
    installExtendedHooks({ homeDir, cwd, agent: "kimi" });
    const raw = readFileSync(file, "utf8"), value = TOML.parse(raw);
    assert.match(raw, /# preserve/); assert.equal(value.default_model, "test"); assert.equal(value.hooks.length, 2);
  });
  it("preserves unrelated Codex and Copilot hooks", () => {
    for (const agent of ["codex", "github-copilot"]) {
      const cwd = temp(), homeDir = temp(), file = join(cwd, agent === "codex" ? ".codex/hooks.json" : ".github/hooks/conversation-memory.json");
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, JSON.stringify({ hooks: { [agent === "codex" ? "Stop" : "agentStop"]: agent === "codex" ? [{ hooks: [{ type: "command", command: "other" }] }] : [{ type: "command", bash: "other" }] } }));
      installExtendedHooks({ cwd, homeDir, agent }); assert.match(readFileSync(file, "utf8"), /other/);
    }
  });
  it("does not claim full capture when the host response contract has not been verified", () => {
    for (const agent of ["kiro-ide", "antigravity", "generic", "trae"]) {
      const result = installExtendedHooks({ cwd: temp(), homeDir: temp(), agent });
      assert.equal(result.mode, "instructions"); assert.ok(result.reason);
    }
  });
  it("requires explicit Trae CN selection instead of assuming international compatibility", () => {
    const cwd = temp(), homeDir = temp(); mkdirSync(join(cwd, ".trae"));
    assert.equal(installExtendedHooks({ cwd, homeDir, agent: "trae" }).mode, "instructions");
    const result = installExtendedHooks({ cwd, homeDir, agent: "trae-cn" });
    assert.equal(result.mode, "automatic"); assert.ok(JSON.parse(readFileSync(result.file)).hooks.Stop);
  });
});
describe("durable capture outbox", () => {
  it("retains a failed save and retries without duplicate messages or broken relations", async () => {
    const stateDir = temp(), db = store();
    const item = { scoped: { sessionId: "pi:s", agentId: "pi", project: "p", projectPath: "p" }, messages: [{ id: "u", role: "user", content: "Question" }, { id: "a", role: "assistant", content: "Answer" }] };
    const { directory } = await enqueue(stateDir, item);
    let failed = false;
    await assert.rejects(() => drain(directory, i => persistMessages(i, async args => {
      if (args.role === "assistant" && !failed) { failed = true; throw new Error("offline"); }
      return db.saveMessage(args);
    })), /offline/);
    assert.equal(readdirSync(directory).filter(f => f.endsWith(".json")).length, 1);
    await drain(directory, i => persistMessages(i, db.saveMessage));
    assert.equal(db.rows.size, 2); assert.equal([...db.rows.values()][1].relatedMessageId, [...db.rows.values()][0].id);
    assert.equal(readdirSync(directory).length, 0);
  });
  it("serializes concurrent drains and isolates projects", async () => {
    const root = temp(); const item = p => ({ scoped: { projectPath: p }, messages: [] });
    const a = await enqueue(root, item("a")), b = await enqueue(root, item("b"));
    assert.notEqual(a.directory, b.directory);
    let release; const wait = new Promise(r => { release = r; }); let count = 0;
    const first = drain(a.directory, async () => { count++; await wait; });
    await new Promise(r => setTimeout(r, 25)); await drain(a.directory, () => { count++; }); release(); await first;
    assert.equal(count, 1); assert.equal(readdirSync(b.directory).length, 1);
  });
  it("retains prepared CLI messages even when no database has been configured", () => {
    const cwd = temp();
    const input = { session_id: "offline", cwd, messages: [{ id: "u", role: "user", content: "Offline question" }, { id: "a", role: "assistant", content: "Offline answer" }] };
    const child = spawnSync(process.execPath, [join(__dirname, "../src/cli.js"), "capture", "--agent", "pi"], {
      cwd, input: JSON.stringify(input), encoding: "utf8", timeout: 10000, windowsHide: true,
      env: { ...process.env, CONVERSATION_MEMORY_DATABASE_URL: "", APPDATA: cwd, XDG_CONFIG_HOME: cwd },
    });
    assert.equal(child.status, 0, child.stderr); assert.deepEqual(JSON.parse(child.stdout), {});
    const root = join(cwd, "conversation-memory-mcp/capture/outbox");
    const project = readdirSync(root)[0], file = readdirSync(join(root, project)).find(n => n.endsWith(".json"));
    const pending = JSON.parse(readFileSync(join(root, project, file), "utf8")); assert.equal(pending.messages.length, 2);
    assert.ok(!child.stderr.includes("Offline question"));
  });
});
describe("event plugin bridges", () => {
  const load = name => import(pathToFileURL(join(__dirname, "../plugins", name)).href);
  it("registers Pi capture using persisted branch entry IDs and waits at shutdown", async () => {
    const { createPiCapture } = await load("pi-capture.mjs"), hooks = {}, payloads = [];
    createPiCapture(async (agent, payload) => { payloads.push({ agent, payload }); })({ on: (event, fn) => { hooks[event] = fn; } });
    const ctx = { cwd: temp(), sessionManager: { getSessionId: () => "s", getBranch: () => [
      { type: "message", id: "u", message: { role: "user", content: "Question" } },
      { type: "message", id: "a", message: { role: "assistant", content: [{ type: "thinking", text: "secret" }, { type: "text", text: "Answer" }] } },
    ] } };
    await hooks.agent_end({}, ctx); await hooks.session_shutdown();
    const db = store(); await captureTurn("pi", payloads[0].payload, db); assert.equal(db.rows.size, 2);
  });
  it("registers OpenClaw agent_end and respects incognito omission", async () => {
    const { createOpenClawCapture } = await load("openclaw-capture.mjs"); let hook; const payloads = [];
    createOpenClawCapture(async (_a, p) => payloads.push(p)).register({ on: (name, fn) => { assert.equal(name, "agent_end"); hook = fn; } });
    const ctx = { sessionId: "s", workspaceDir: temp() };
    await hook({ messages: [] }, ctx); assert.equal(payloads.length, 0);
    await hook({ messages: [{ id: "u", role: "user", content: "Question" }, { id: "a", role: "assistant", content: "Answer" }] }, ctx);
    const db = store(); await captureTurn("openclaw", payloads[0], db); assert.equal(db.rows.size, 2);
  });
  it("registers Kilo session.idle and reads messages through its SDK client", async () => {
    const { createKiloCapture } = await load("kilo-capture.mjs"); const payloads = [];
    const cwd = temp();
    const hooks = await createKiloCapture(async (_a, p) => payloads.push(p)).server({ directory: cwd, client: { session: { get: async () => ({ data: { directory: cwd } }), messages: async () => ({ data: [
      { info: { id: "u", role: "user" }, parts: [{ type: "text", text: "Question" }] },
      { info: { id: "a", role: "assistant" }, parts: [{ type: "reasoning", text: "secret" }, { type: "text", text: "Answer" }] },
    ] }) } } });
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "s" } } });
    const db = store(); await captureTurn("kilocode", payloads[0], db); assert.equal(db.rows.size, 2);
  });
  it("spools failed plugin launches and sends conversation text only through stdin", async () => {
    const { sendCapture, stableId } = await load("capture-bridge.mjs"); const stateRoot = temp(), cwd = temp(); let fail = true; const received = [];
    const input = { cwd, session_id: "s", messages: [{ id: "u", role: "user", content: "$(never-execute) & private" }] };
    const spawnProcess = (command, args) => {
      assert.ok(!JSON.stringify([command, args]).includes("never-execute"));
      const child = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
      child.stdin.end = data => { received.push(JSON.parse(data)); queueMicrotask(() => { if (fail) child.stderr.emit("data", "[conversation-memory] unavailable"); child.emit("close", fail ? 1 : 0); }); };
      return child;
    };
    const directory = join(stateRoot, "conversation-memory-mcp/capture/bridge", stableId(["pi", cwd]));
    await sendCapture("pi", input, { spawnProcess, stateRoot }); assert.equal(readdirSync(directory).length, 1);
    fail = false; await sendCapture("pi", input, { spawnProcess, stateRoot }); assert.equal(readdirSync(directory).length, 0);
    assert.deepEqual(received[0], input);
  });
});

describe("persistent native launcher", () => {
  function fixture(cwd, acknowledge) {
    const bin = join(cwd, "bin"); mkdirSync(bin, { recursive: true });
    const script = join(cwd, "npm-fixture.cjs");
    writeFileSync(script, `let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{require('node:fs').writeFileSync(process.env.CM_LAUNCH_LOG,s);process.stdout.write(JSON.stringify({queued:${acknowledge}}));});`);
    const entry = join(bin, process.platform === "win32" ? "npx.cmd" : "npx");
    writeFileSync(entry, process.platform === "win32" ? `@echo off\r\n"${process.execPath}" "${script}"\r\n` : `#!/bin/sh\nexec "${process.execPath}" "${script}"\n`);
    if (process.platform !== "win32") chmodSync(entry, 0o755);
    return { bin, env: { ...process.env, PATH: bin + require("node:path").delimiter + process.env.PATH, APPDATA: cwd, XDG_CONFIG_HOME: cwd, CM_LAUNCH_LOG: join(cwd, "received.json") } };
  }
  it("spools before npm starts, excludes unrelated payload data and retries on the next event", () => {
    const cwd = temp(), file = join(cwd, "launcher.cjs"); captureCommand(file, "hermes");
    const input = { cwd, session_id: "s", extra: { turn_id: "t", user_message: "Question", assistant_response: "Answer", conversation_history: "PRIVATE THINKING" } };
    const first = fixture(cwd, false);
    const invoke = env => spawnSync(process.execPath, [file, "--agent", "hermes"], { cwd, input: JSON.stringify(input), env, encoding: "utf8", timeout: 10000, windowsHide: true });
    const result = invoke(first.env); assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), {});
    const launchers = join(cwd, "conversation-memory-mcp/capture/launchers"); const directory = join(launchers, readdirSync(launchers)[0]);
    const pending = readdirSync(directory).find(n => n.endsWith(".json"));
    assert.ok(pending); assert.ok(!readFileSync(join(directory, pending), "utf8").includes("PRIVATE THINKING"));
    const second = fixture(cwd, true); const retried = invoke(second.env); assert.equal(retried.status, 0, retried.stderr);
    assert.equal(readdirSync(directory).filter(n => n.endsWith(".json")).length, 0);
    assert.equal(JSON.parse(readFileSync(second.env.CM_LAUNCH_LOG)).extra.assistant_response, "Answer");
  });
  it("makes shell-safe commands even when the launcher path contains shell metacharacters", () => {
    const cwd = temp(), file = join(cwd, "dollar-$-and-&-quote-'/launcher.cjs");
    const cmd = captureCommand(file, "codex"); assert.ok(!cmd.includes(file));
    assert.match(cmd, /-- capture --agent codex/); assert.match(cmd, /conversation-memory-mcp@/);
  });
  it("runs the Hermes Python shim against a controlled npm launcher", function () {
    const check = spawnSync("python", ["--version"], { encoding: "utf8", windowsHide: true });
    if (check.error || check.status !== 0) this.skip();
    const cwd = temp(), homeDir = temp(), f = fixture(cwd, true);
    installExtendedHooks({ cwd, homeDir, agent: "hermes", scope: "global" });
    const input = { cwd, session_id: "s", extra: { turn_id: "t", user_message: "Question", assistant_response: "Answer" } };
    const result = spawnSync("python", [join(homeDir, ".hermes/agent-hooks/conversation-memory-mcp.py")], { cwd, input: JSON.stringify(input), env: f.env, encoding: "utf8", timeout: 10000, windowsHide: true });
    assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), {});
    assert.equal(JSON.parse(readFileSync(f.env.CM_LAUNCH_LOG)).extra.turn_id, "t");
  });
});
