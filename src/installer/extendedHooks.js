const { existsSync, readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const { join, dirname } = require("node:path");
const { pathToFileURL } = require("node:url");
const TOML = require("@iarna/toml");
const YAML = require("yaml");
const { readConfig, updateConfig } = require("./configFiles");
const { canonical } = require("../hooks/extended");
const { kimiHome } = require("../hooks/kimiHome");
const { version } = require("../../package.json");
const { captureCommand } = require("./captureLauncher");
const managed = entry => typeof entry?.command === "string" && entry.command.includes("conversation-memory-mcp") && entry.command.includes(" capture ");
function write(file, text) {
  if (existsSync(file) && readFileSync(file, "utf8") === text) return false;
  mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text, "utf8"); return true;
}
function command(agent, file) { return captureCommand(join(dirname(file), "conversation-memory/capture-launcher.cjs"), agent); }
function grouped(file, events, agent, { copilot = false } = {}) {
  let changed = false;
  if (copilot) changed = updateConfig(file, ["version"], 1);
  for (const event of events) {
    const old = readConfig(file).value.hooks?.[event] || [];
    if (!Array.isArray(old)) throw new Error(`Invalid hooks array: ${file} ${event}`);
    const cmd = command(agent, file);
    const entry = copilot ? { type: "command", bash: cmd, powershell: cmd, timeoutSec: 60 } : { hooks: [{ type: "command", command: cmd, timeout: 60 }] };
    const others = copilot ? old.filter(e => !managed({ command: e.bash || e.command }) && !managed({ command: e.powershell })) : old.map(group => ({ ...group, hooks: (group.hooks || []).filter(e => !managed(e)) })).filter(g => g.hooks.length);
    changed = updateConfig(file, ["hooks", event], [...others, entry]) || changed;
  }
  return { mode: "automatic", file, events, changed, requiresHostTrust: true };
}
function pluginFiles(destination, source) {
  let changed = false;
  for (const [name, original] of [["index.mjs", source], ["capture-bridge.mjs", "capture-bridge.mjs"]]) {
    const text = readFileSync(join(__dirname, "../../plugins", original), "utf8").replaceAll("__VERSION__", version);
    changed = write(join(destination, name), text) || changed;
  }
  return changed;
}
function installExtendedHooks({ cwd, agent, scope = "project", homeDir }) {
  const originalAgent = agent;
  agent = canonical(agent);
  const root = scope === "global" ? homeDir : cwd;
  if (agent === "codex") return grouped(join(root, ".codex/hooks.json"), ["UserPromptSubmit", "Stop"], agent);
  if (agent === "qwen-code") return grouped(join(root, ".qwen/settings.json"), ["Stop"], agent);
  if (agent === "github-copilot") return grouped(scope === "global" ? join(root, ".copilot/hooks/conversation-memory.json") : join(root, ".github/hooks/conversation-memory.json"), ["agentStop"], agent, { copilot: true });
  if (agent === "kimi") {
    const base = kimiHome(homeDir);
    const file = join(base, "config.toml");
    const raw = existsSync(file) ? readFileSync(file, "utf8") : "";
    const value = TOML.parse(raw);
    if (value.hooks && !Array.isArray(value.hooks)) throw new Error("Kimi hooks must be an array");
    // Preserve comments/settings outside our marked TOML block. Existing native hooks survive.
    const start = "# conversation-memory-mcp capture BEGIN", end = "# conversation-memory-mcp capture END";
    const a = raw.indexOf(start), b = raw.indexOf(end);
    if ((a < 0) !== (b < 0)) throw new Error("Incomplete managed Kimi hook block");
    const clean = a < 0 ? raw : raw.slice(0, a) + raw.slice(b + end.length).replace(/^\r?\n/, "");
    const entry = { event: "Stop", command: command(agent, file), timeout: 60 };
    const next = clean.trimEnd() + (clean.trim() ? "\n\n" : "") + start + "\n" + TOML.stringify({ hooks: [entry] }) + end + "\n";
    TOML.parse(next);
    return { mode: "automatic", file, events: ["Stop"], changed: write(file, next), scope: "global", requiresHostTrust: true };
  }
  if (agent === "windsurf") {
    const file = join(homeDir, ".codeium/windsurf/hooks.json");
    const event = "post_cascade_response_with_transcript";
    const old = readConfig(file).value.hooks?.[event] || [];
    const changed = updateConfig(file, ["hooks", event], [...old.filter(e => !managed(e)), { command: command(agent, file), show_output: false }]);
    return { mode: "automatic", file, events: [event], changed, writesHostTranscript: true };
  }
  if (agent === "hermes") {
    const base = process.env.HERMES_HOME || join(homeDir, ".hermes");
    const file = join(base, "config.yaml");
    const doc = YAML.parseDocument(existsSync(file) ? readFileSync(file, "utf8") : "{}");
    if (doc.errors.length) throw new Error("Invalid Hermes YAML configuration");
    // Hermes uses shell=False, so Windows requires a Python shim, not a .cmd command.
    const shim = join(base, "agent-hooks/conversation-memory-mcp.py");
    const launcher = join(base, "agent-hooks/conversation-memory/capture-launcher.cjs");
    captureCommand(launcher, agent);
    const python = `import sys, subprocess\ntry:\n    subprocess.run(["node", ${JSON.stringify(launcher)}, "--agent", "hermes"], input=sys.stdin.buffer.read(), stdout=subprocess.DEVNULL, timeout=55, check=False)\nexcept Exception:\n    sys.stderr.write("[conversation-memory] capture launcher failed\\n")\nprint("{}")\n`;
    let changed = write(shim, python);
    const event = "post_llm_call";
    const old = doc.toJS()?.hooks?.[event] || [];
    if (!Array.isArray(old)) throw new Error("Invalid Hermes hooks array");
    doc.setIn(["hooks", event], [...old.filter(e => !managed(e) && !e.command?.includes("conversation-memory-mcp.py")), { command: `"${shim.replaceAll("\\", "/")}"`, timeout: 60 }]);
    changed = write(file, String(doc)) || changed;
    return { mode: "automatic", file, events: [event], changed, requiresHostTrust: true };
  }
  if (agent === "pi") {
    const destination = scope === "global" ? join(homeDir, ".pi/agent/extensions/conversation-memory") : join(cwd, ".pi/extensions/conversation-memory");
    let changed = pluginFiles(destination, "pi-capture.mjs");
    changed = write(join(destination, "package.json"), JSON.stringify({ private: true, type: "module", pi: { extensions: ["./index.mjs"] } }, null, 2) + "\n") || changed;
    return { mode: "automatic", file: join(destination, "index.mjs"), changed, events: ["agent_end"] };
  }
  if (agent === "kilocode") {
    const destination = join(cwd, ".kilo/conversation-memory-capture");
    let changed = pluginFiles(destination, "kilo-capture.mjs");
    const file = join(cwd, ".kilo/kilo.jsonc");
    const old = readConfig(file).value.plugin || [];
    if (!Array.isArray(old)) throw new Error("Invalid Kilo plugin array");
    const entry = pathToFileURL(join(destination, "index.mjs")).href;
    changed = updateConfig(file, ["plugin"], [...old.filter(p => p !== entry), entry]) || changed;
    return { mode: "automatic", file, changed, events: ["session.idle"] };
  }
  if (agent === "openclaw") {
    const base = join(homeDir, ".openclaw");
    const destination = join(base, "extensions/conversation-memory-capture");
    let changed = pluginFiles(destination, "openclaw-capture.mjs");
    changed = write(join(destination, "package.json"), JSON.stringify({ name: "conversation-memory-capture", version, type: "module", openclaw: { extensions: ["./index.mjs"] } }, null, 2) + "\n") || changed;
    changed = write(join(destination, "openclaw.plugin.json"), JSON.stringify({ id: "conversation-memory-capture", name: "Conversation Memory Capture", configSchema: { type: "object", additionalProperties: false, properties: {} } }, null, 2) + "\n") || changed;
    const file = process.env.OPENCLAW_CONFIG_PATH || join(base, "openclaw.json");
    changed = updateConfig(file, ["plugins", "entries", "conversation-memory-capture", "enabled"], true) || changed;
    changed = updateConfig(file, ["plugins", "entries", "conversation-memory-capture", "hooks", "allowConversationAccess"], true) || changed;
    const allow = readConfig(file).value.plugins?.allow;
    if (Array.isArray(allow) && !allow.includes("conversation-memory-capture")) changed = updateConfig(file, ["plugins", "allow"], [...allow, "conversation-memory-capture"]) || changed;
    return { mode: "automatic", file, changed, events: ["agent_end"], requiresHostTrust: true };
  }
  if (agent === "trae" && originalAgent === "trae-cn") {
    return grouped(join(cwd, ".trae/hooks.json"), ["UserPromptSubmit", "Stop"], agent);
  }
  const reason = agent === "kiro-ide" ? "Kiro tiene hooks, pero falta un contrato comprobado para leer la respuesta y su identidad." : agent === "antigravity" ? "Antigravity tiene hooks; falta validar el formato de su transcripcion antes de activar captura completa." : agent === "trae" ? "Los hooks verificados corresponden a Trae CN: use --agent trae-cn solo para esa edicion." : "Este cliente no dispone de un adaptador automatico.";
  return { mode: "instructions", reason };
}
module.exports = { installExtendedHooks, grouped };
