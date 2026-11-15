const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { captureTurn } = require("../src/hooks/capture");
const { install } = require("../src/installer");
const { version } = require("../package.json");
const temp = () => mkdtempSync(join(tmpdir(), "cm-native-"));
function store() {
  const rows = new Map();
  const saveMessage = async args => {
    const key = args.sessionId + ":" + args.sourceMessageId;
    if (!rows.has(key)) rows.set(key, { args, id: `saved-${rows.size}` });
    return { success: true, messageId: rows.get(key).id };
  };
  return { rows, saveMessage };
}
describe("native capture", () => {
  it("captures Claude transcript turns once, links messages and excludes tools and thinking", async () => {
    const dir = temp(), file = join(dir, "transcript.jsonl"), { rows, saveMessage } = store();
    const records = [
      { uuid: "old-u", message: { role: "user", content: "old question" } },
      { uuid: "u", message: { role: "user", content: [{ type: "text", text: "Current user question" }] } },
      { uuid: "tool", message: { role: "user", content: [{ type: "tool_result", content: "internal output" }] } },
      { uuid: "a", message: { role: "assistant", content: [{ type: "thinking", thinking: "private" }, { type: "text", text: "Visible answer" }] } },
    ];
    writeFileSync(file, records.map(row => JSON.stringify(row)).join("\n"));
    const input = { session_id: "session", cwd: dir, transcript_path: file };
    await captureTurn("claude", input, { saveMessage }); await captureTurn("claude", input, { saveMessage });
    assert.equal(rows.size, 2);
    const [user, assistant] = [...rows.values()];
    assert.equal(assistant.args.relatedMessageId, user.id); assert.equal(assistant.args.content, "Visible answer");
    assert.ok(user.args.project); assert.equal(user.args.projectPath, dir);
  });
  it("captures a Gemini turn using stable transcript IDs and omits thoughts", async () => {
    const dir = temp(), file = join(dir, "transcript.json"), { rows, saveMessage } = store();
    writeFileSync(file, JSON.stringify({ messages: [
      { id: "g-user", type: "user", content: "Question for Gemini" },
      { id: "g-assistant", type: "gemini", content: [{ text: "Secret", thought: true }, { text: "Visible Gemini answer" }], thoughts: [{ text: "private" }] },
    ] }));
    const input = { session_id: "session", cwd: dir, transcript_path: file, prompt_response: "Visible Gemini answer" };
    await captureTurn("gemini-cli", input, { saveMessage }); await captureTurn("gemini-cli", input, { saveMessage });
    assert.equal(rows.size, 2); assert.equal([...rows.values()][1].args.content, "Visible Gemini answer");
  });
  it("accepts Gemini single-part and mixed string/part transcript content", async () => {
    const dir = temp(), file = join(dir, "transcript.json"), { rows, saveMessage } = store();
    writeFileSync(file, JSON.stringify({ messages: [
      { id: "part-user", type: "user", content: { text: "Single part prompt" } },
      { id: "part-answer", type: "gemini", content: ["First line", { text: "Second line" }, { text: "Private", thought: true }] },
    ] }));
    await captureTurn("gemini-cli", { session_id: "parts", cwd: dir, transcript_path: file }, { saveMessage });
    assert.equal(rows.size, 2); assert.equal([...rows.values()][1].args.content, "First line\nSecond line");
  });
  it("pairs Cursor prompt/response across processes and recovers after a failed prompt save", async () => {
    const dir = temp(), stateDir = join(dir, "capture"), { rows, saveMessage } = store();
    const base = { conversation_id: "conversation", generation_id: "turn", workspace_roots: [dir] };
    await assert.rejects(() => captureTurn("cursor", { ...base, hook_event_name: "beforeSubmitPrompt", prompt: "A Cursor question" }, {
      stateDir, saveMessage: async () => { throw new Error("network"); },
    }), /network/);
    const response = { ...base, hook_event_name: "afterAgentResponse", text: "A Cursor answer" };
    await captureTurn("cursor", response, { stateDir, saveMessage }); await captureTurn("cursor", response, { stateDir, saveMessage });
    assert.equal(rows.size, 2); const [user, assistant] = [...rows.values()];
    assert.equal(assistant.args.relatedMessageId, user.id);
  });
  it("refuses payloads without a stable project/session/message identity", async () => {
    await assert.rejects(() => captureTurn("claude", {}, store()), /Missing session/);
    await assert.rejects(() => captureTurn("cursor", { conversation_id: "s", cwd: temp() }, store()), /generation_id/);
  });
});
describe("native hook installation", () => {
  for (const agent of ["claude", "cursor", "gemini-cli"]) for (const scope of ["project", "global"]) {
    it(`installs ${agent} ${scope} capture idempotently without replacing other hooks`, () => {
      const cwd = temp(), homeDir = temp();
      const root = scope === "project" ? cwd : homeDir;
      const directory = join(root, agent === "claude" ? ".claude" : agent === "cursor" ? ".cursor" : ".gemini");
      mkdirSync(directory, { recursive: true });
      const file = join(directory, agent === "cursor" ? "hooks.json" : "settings.json");
      const event = agent === "claude" ? "Stop" : agent === "cursor" ? "afterAgentResponse" : "AfterAgent";
      const other = agent === "cursor" ? { command: "other-hook" } : { hooks: [{ type: "command", command: "other-hook" }] };
      writeFileSync(file, JSON.stringify({ hooks: { [event]: [other] } }));
      const first = install({ cwd, homeDir, agent, scope });
      assert.equal(first.capture.mode, "automatic"); assert.equal(first.capture.file, file);
      const text = readFileSync(file, "utf8");
      assert.match(text, /other-hook/); assert.ok(text.includes(`conversation-memory-mcp@${version}`));
      assert.match(readFileSync(first.file, "utf8"), /no ejecutes saveMessage manualmente/);
      install({ cwd, homeDir, agent, scope }); assert.equal(readFileSync(file, "utf8"), text);
    });
  }
  it("does not claim automatic capture for agents without a native adapter", () => {
    const result = install({ cwd: temp(), agent: "generic" });
    assert.equal(result.capture.mode, "instructions");
  });
});
