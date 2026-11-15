const { readFile, readdir } = require("node:fs/promises");
const { join, dirname } = require("node:path");
const { homedir } = require("node:os");
const { createHash } = require("node:crypto");
const { kimiHome } = require("./kimiHome");
const digest = value => createHash("sha256").update(value).digest("hex");
const ALIASES = { "kimi-code": "kimi", "trae-cn": "trae", copilot: "github-copilot", "vscode-copilot": "github-copilot" };
const EXTENDED = new Set(["codex", "qwen-code", "github-copilot", "kimi", "windsurf", "hermes", "pi", "kilocode", "openclaw", "antigravity", "trae"]);
const canonical = agent => ALIASES[agent] || agent;
function visible(content) {
  if (typeof content === "string") return content;
  return (Array.isArray(content) ? content : []).filter(p => p && !p.thought && (!p.type || ["text", "input_text", "output_text"].includes(p.type))).map(p => p.text || "").join("\n");
}
function envelope(agent, input) {
  agent = canonical(agent);
  return { agent, session: input.session_id || input.sessionId || input.trajectory_id || input.conversationId,
    directory: input.cwd || input.workspace_roots?.[0] || input.workspacePaths?.[0] || (agent === "windsurf" ? process.cwd() : undefined),
    file: input.transcript_path || input.transcriptPath || input.tool_info?.transcript_path };
}
async function kimiFile(input, homeDir) {
  // Use the exact session identity; never select another session by modification time.
  if (!/^[\w-]+$/.test(input.session_id || "")) throw new Error("Invalid Kimi session ID");
  const primary = kimiHome(homeDir);
  const roots = process.env.KIMI_SHARE_DIR ? [primary] : [...new Set([primary, join(homeDir, ".kimi"), join(homeDir, ".kimi-code")])];
  for (const root of roots) {
    let directories;
    try { directories = await readdir(join(root, "sessions"), { withFileTypes: true }); } catch (e) { if (e.code === "ENOENT") continue; throw e; }
    const matches = [];
    for (const dir of directories.filter(d => d.isDirectory())) {
      const file = join(root, "sessions", dir.name, input.session_id, "context.jsonl");
      try { await readFile(file, "utf8"); matches.push(file); } catch (e) { if (e.code !== "ENOENT") throw e; }
    }
    if (matches.length > 1) throw new Error("Ambiguous Kimi session");
    if (matches.length) return matches[0];
  }
  throw new Error("Kimi transcript unavailable");
}
function parseRows(agent, source) {
  let records;
  try { const value = JSON.parse(source); records = Array.isArray(value) ? value : value.messages; } catch { /* JSONL below */ }
  if (!Array.isArray(records)) records = source.split(/\r?\n/).filter(s => s.trim()).map(s => JSON.parse(s));
  const rows = [];
  if (agent === "kimi" && records.some(r => r.message?.type === "TurnBegin")) {
    let answer = "", answerId;
    const flush = () => { if (answer.trim()) rows.push({ id: answerId, role: "assistant", content: answer }); answer = ""; answerId = undefined; };
    for (const [i, record] of records.entries()) {
      const message = record.message;
      if (!message) continue;
      const id = `wire:${record.timestamp}:${i}`;
      if (["TurnBegin", "SteerInput"].includes(message.type)) {
        flush(); const content = visible(message.payload?.user_input); if (content.trim()) rows.push({ id, role: "user", content });
      } else if (["StepBegin", "TurnEnd", "ToolCall"].includes(message.type)) flush();
      else if (["StepRetry", "StepInterrupted"].includes(message.type)) { answer = ""; answerId = undefined; }
      else if (message.type === "ContentPart" && message.payload?.type === "text") {
        answerId ||= id; answer += message.payload.text || "";
      }
    }
    flush();
    if (!rows.length) throw new Error("Unsupported Kimi wire transcript");
    return rows;
  }
  const occurrences = new Map();
  for (const [index, r] of records.entries()) {
    let role, content, id;
    if (r.isMeta || r.isSidechain || r.agentId || r.parentToolCallId) continue;
    if (agent === "github-copilot") {
      if (!["user.message", "assistant.message"].includes(r.type)) continue;
      if (r.checkpoint || r.data?.parentToolCallId || r.data?.isAutopilotContinuation || /^(skill-|agent-)/.test(r.data?.source || "") || ["analysis", "thinking", "reasoning"].includes(r.data?.phase)) continue;
      role = r.type === "user.message" ? "user" : "assistant";
      content = visible(r.data?.content); id = r.data?.messageId || r.id;
    } else if (agent === "windsurf") {
      if (r.status !== "done") continue;
      if (r.type === "user_input") { role = "user"; content = r.user_input?.user_response; }
      if (r.type === "planner_response") { role = "assistant"; content = r.planner_response?.response; }
      id = r.id || `step:${index}`;
    } else if (agent === "codex") {
      // Rollout response_item records contain developer/tool context too. Whitelist roles.
      if (r.type !== "response_item" || r.payload?.type !== "message") continue;
      role = r.payload.role; content = visible(r.payload.content); id = r.payload.id || `${r.timestamp}:${index}`;
    } else if (agent === "antigravity") {
      // Supported JSONL export: explicit user and visible model messages only.
      if (r.type === "user_input") { role = "user"; content = r.user_input?.user_response; }
      if (r.type === "planner_response") { role = "assistant"; content = r.planner_response?.response; }
      id = r.id || `step:${index}`;
    } else if (agent === "qwen-code") {
      if (!["user", "assistant", "gemini"].includes(r.type) || r.subtype || (r.provenance && !["real_user", "assistant_output"].includes(r.provenance))) continue;
      const m = r.message || r;
      role = r.type === "user" ? "user" : "assistant";
      content = role === "user" && typeof r.systemPayload?.displayText === "string" ? r.systemPayload.displayText : visible(m.displayContent || m.parts || m.content); id = r.uuid || r.id || m.id;
    } else if (agent === "kimi") {
      role = r.role; content = visible(r.content);
      const key = digest(JSON.stringify([role, content]));
      const n = occurrences.get(key) || 0; occurrences.set(key, n + 1);
      id = r.id || `${key}:${n}`;
    }
    if (!["user", "assistant"].includes(role) || typeof content !== "string" || !content.trim()) continue;
    if (!id) throw new Error("Transcript message identity unavailable");
    rows.push({ id: String(id), role, content, ...(agent === "github-copilot" && r.data?.originatingMessageId ? { parentId: r.data.originatingMessageId } : {}) });
  }
  if (!rows.length) throw new Error("Unsupported or empty transcript");
  return rows;
}
async function extendedMessages(agent, input, { homeDir = homedir() } = {}) {
  const info = envelope(agent, input); agent = info.agent;
  if (!EXTENDED.has(agent)) throw new Error("Unsupported capture agent");
  if (!info.session || !info.directory) throw new Error("Missing session or project directory");
  if (["hermes", "pi", "kilocode", "openclaw"].includes(agent)) {
    if (agent === "hermes") {
      const data = input.extra || input;
      if (!data.turn_id) throw new Error("Missing Hermes turn_id");
      return { ...info, messages: [
        { id: `${data.turn_id}:user`, role: "user", content: visible(data.user_message) },
        { id: `${data.turn_id}:assistant`, role: "assistant", content: visible(data.assistant_response) },
      ].filter(m => m.content.trim()) };
    }
    if (!Array.isArray(input.messages)) throw new Error("Missing plugin messages");
    const messages = input.messages.filter(m => ["user", "assistant"].includes(m.role)).map(m => ({ id: m.id, role: m.role, content: visible(m.content) })).filter(m => m.content.trim());
    return { ...info, messages };
  }
  const file = info.file || (agent === "kimi" ? await kimiFile(input, homeDir) : null);
  if (!file) throw new Error("Missing transcript path");
  if (agent === "kimi" && !info.file) {
    try { return { ...info, messages: parseRows(agent, await readFile(join(dirname(file), "wire.jsonl"), "utf8")) }; }
    catch (e) { if (e.code !== "ENOENT") throw e; }
  }
  return { ...info, messages: parseRows(agent, await readFile(file, "utf8")) };
}
module.exports = { canonical, EXTENDED, envelope, extendedMessages, parseRows };
