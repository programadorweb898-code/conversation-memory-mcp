const { join, dirname } = require("node:path");
const { readConfig, updateConfig } = require("./configFiles");
const { captureCommand } = require("./captureLauncher");
const NATIVE_AGENTS = new Set(["claude", "cursor", "gemini-cli"]);
function installHooks({ cwd, agent, scope = "project", homeDir }) {
  if (!NATIVE_AGENTS.has(agent)) return require("./extendedHooks").installExtendedHooks({ cwd, agent, scope, homeDir });
  const root = scope === "global" ? homeDir : cwd;
  const file = agent === "claude" ? join(root, ".claude", "settings.json") :
    agent === "cursor" ? join(root, ".cursor", "hooks.json") : join(root, ".gemini", "settings.json");
  const { value } = readConfig(file);
  const command = captureCommand(join(dirname(file), "conversation-memory/capture-launcher.cjs"), agent);
  const managed = entry => typeof entry.command === "string" && entry.command.includes("conversation-memory-mcp") && entry.command.includes(" capture ");
  const events = agent === "claude" ? ["Stop"] : agent === "cursor" ? ["beforeSubmitPrompt", "afterAgentResponse"] : ["AfterAgent"];
  let changed = false;
  if (agent === "cursor") changed = updateConfig(file, ["version"], 1) || changed;
  for (const event of events) {
    const old = value.hooks?.[event] || [];
    let entries;
    if (agent === "cursor") {
      entries = [...old.filter(entry => !managed(entry)), { command, timeout: 60 }];
    } else {
      const others = old.map(group => ({ ...group, hooks: (group.hooks || []).filter(entry => !managed(entry)) })).filter(group => group.hooks.length);
      entries = [...others, { hooks: [{ type: "command", command, timeout: agent === "claude" ? 60 : 60000 }] }];
    }
    changed = updateConfig(file, ["hooks", event], entries) || changed;
  }
  return { mode: "automatic", file, events, changed };
}
module.exports = { installHooks, NATIVE_AGENTS };
