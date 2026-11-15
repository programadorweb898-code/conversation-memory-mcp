const { readFile, mkdir, writeFile, rename } = require("node:fs/promises");
const { dirname, join } = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { canonical, EXTENDED, envelope, extendedMessages } = require("./extended");
const CAPTURE_AGENTS = new Set(["claude", "cursor", "gemini-cli", ...EXTENDED]);
const hash = value => createHash("sha256").update(value).digest("hex");
function text(content) {
  if (typeof content === "string") return content;
  const parts = Array.isArray(content) ? content : content ? [content] : [];
  return parts.flatMap(part => {
    if (typeof part === "string") return [part];
    return part && (!part.type || part.type === "text") && typeof part.text === "string" && !part.thought ? [part.text] : [];
  }).join("\n");
}

function latestTurn(rows) {
  const messages = rows.filter(row => row.content?.trim());
  const start = messages.findLastIndex(row => row.role === "user");
  return start < 0 ? [] : messages.slice(start);
}
async function transcriptMessages(agent, input) {
  if (!input.transcript_path) throw new Error("Missing transcript_path");
  const source = await readFile(input.transcript_path, "utf8");
  if (agent === "gemini-cli") {
    const record = JSON.parse(source);
    const rows = (record.messages || []).filter(m => m.type === "user" || m.type === "gemini")
      .map(m => ({ id: m.id, role: m.type === "user" ? "user" : "assistant", content: text(m.displayContent || m.content) }));
    const turn = latestTurn(rows);
    if (turn[0] && input.prompt_response && !turn.some(m => m.role === "assistant" && m.content === input.prompt_response)) {
      turn.push({ role: "assistant", content: input.prompt_response });
    }
    return turn.map(m => m.role === "assistant" ? { ...m, id: `${turn[0].id}:response:${hash(m.content)}` } : m);
  }
  const rows = [];
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    if (record.isMeta || record.isSidechain || !record.uuid) continue;
    const role = record.message?.role;
    if (role !== "user" && role !== "assistant") continue;
    const content = text(record.message.content);
    if (content) rows.push({ id: record.uuid, role, content });
  }
  return latestTurn(rows);
}
async function captureTurn(agent, input, { saveMessage, stateDir, prepareOnly = false } = {}) {
  agent = canonical(agent);
  if (!CAPTURE_AGENTS.has(agent)) throw new Error("Unsupported capture agent");
  const info = envelope(agent, input);
  const session = info.session || input.conversation_id;
  const directory = info.directory;
  if (!session || !directory) throw new Error("Missing session or project directory");
  const { resolveProjectIdentity } = await import("../../plugins/projectIdentity.mjs");
  const project = resolveProjectIdentity("", directory);
  if (!project) throw new Error("Invalid project directory");
  const sessionId = `${agent}:${session}`;
  const scoped = { sessionId, project, projectPath: directory, agentId: agent };
  let messages;
  let state;
  let stateFile;
  if (agent === "cursor") {
    if (!input.generation_id) throw new Error("Missing generation_id");
    if (!stateDir) throw new Error("Missing capture state directory");
    stateFile = join(stateDir, hash(JSON.stringify([agent, directory, session, input.generation_id])) + ".json");
    try { state = JSON.parse(await readFile(stateFile, "utf8")); } catch { state = {}; }
    if (input.hook_event_name === "beforeSubmitPrompt") {
      if (typeof input.prompt !== "string" || !input.prompt.trim()) return;
      state.prompt = input.prompt;
    }
    if (!state.prompt) throw new Error("User prompt was not captured for this generation");
    messages = [{ id: `${input.generation_id}:user`, role: "user", content: state.prompt }];
    if (input.hook_event_name === "afterAgentResponse" && typeof input.text === "string" && input.text.trim()) {
      messages.push({ id: `${input.generation_id}:assistant:${hash(input.text)}`, role: "assistant", content: input.text });
    }
    // Persist the prompt before any network request so a later response can recover it.
    await mkdir(stateDir, { recursive: true });
    const pendingFile = stateFile + "." + randomUUID() + ".tmp";
    await writeFile(pendingFile, JSON.stringify(state), { mode: 0o600 }); await rename(pendingFile, stateFile);
  } else if (["codex", "trae"].includes(agent) && ["UserPromptSubmit", "Stop"].includes(input.hook_event_name)) {
    if (agent === "codex" && !input.turn_id) throw new Error("Missing Codex turn_id; update Codex");
    messages = await require("./paired").pairedMessages(agent, input, stateDir);
  } else if (EXTENDED.has(agent)) {
    messages = (await extendedMessages(agent, input)).messages;
  } else {
    messages = await transcriptMessages(agent, input);
  }
  for (const m of messages) {
    if (typeof m.id !== "string" || !m.id) throw new Error("Missing transcript message ID");
    if (!["user", "assistant"].includes(m.role) || typeof m.content !== "string") throw new Error("Invalid captured message");
  }
  if (prepareOnly) return { scoped, messages };
  return persistMessages({ scoped, messages }, saveMessage);
}
async function persistMessages({ scoped, messages }, saveMessage) {
  let relatedMessageId;
  const users = new Map();
  for (const message of messages) {
    if (typeof message.id !== "string" || !message.id) throw new Error("Missing transcript message ID");
    const parent = message.parentId ? users.get(message.parentId) : relatedMessageId;
    const args = { ...scoped, role: message.role, content: message.content, sourceMessageId: `${scoped.agentId}:${message.id}`,
      ...(message.role === "assistant" && parent ? { relatedMessageId: parent } : {}) };
    const saved = await saveMessage(args);
    if (!saved?.success || !saved.messageId) throw new Error("Message was not confirmed");
    if (message.role === "user") { relatedMessageId = saved.messageId; users.set(message.id, saved.messageId); }
  }
}
async function main() {
  const agent = canonical(process.argv[process.argv.indexOf("--agent") + 1]);
  let db;
  let output = {};
  const originalLog = console.log;
  try {
    if (!CAPTURE_AGENTS.has(agent)) throw new Error("Unsupported capture agent");
    let raw = "";
    for await (const chunk of process.stdin) {
      raw += chunk;
      if (raw.length > 8 * 1024 * 1024) throw new Error("Hook input is too large");
    }
    const input = JSON.parse(raw);
    if (agent === "cursor" && input.hook_event_name === "beforeSubmitPrompt") output = { continue: true };
    const cwd = envelope(agent, input).directory;
    if (cwd) process.chdir(cwd);
    console.log = (...args) => console.error(...args);
    process.env.CONVERSATION_MEMORY_QUERY_TIMEOUT_MS ||= "10000";
    const { getDatabaseUrl, getGlobalDatabaseEnvFile } = require("../databaseConfig");
    const stateDir = join(dirname(getGlobalDatabaseEnvFile()), "capture");
    const prepared = await captureTurn(agent, input, { stateDir, prepareOnly: true });
    const outbox = require("./outbox");
    const pending = await outbox.enqueue(stateDir, prepared);
    if (process.env.CM_CAPTURE_ACK === "1") output = { queued: true };
    if (!getDatabaseUrl()) throw new Error("Conversation Memory database is not configured");
    db = require("../database").db;
    await outbox.drain(pending.directory, item => persistMessages(item, require("../tools/saveMessage")));
  } catch (error) {
    // A recorder must never block the agent, trigger another turn or leak credentials.
    console.error(`[conversation-memory] No se pudo capturar el turno (${error.code || error.name}).`);
  } finally {
    if (db) await db.close().catch(() => {});
    console.log = originalLog;
    process.stdout.write(JSON.stringify(output) + "\n");
  }
}
module.exports = { captureTurn, transcriptMessages, persistMessages, main, CAPTURE_AGENTS };
