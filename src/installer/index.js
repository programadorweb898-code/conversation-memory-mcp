const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { dirname, join, resolve } = require("node:path");
const { MEMORY_POLICY, POLICY_MARKER, POLICY_END_MARKER } = require("./policy");
const { AGENTS, normalizeAgent, installMcpConfig } = require("./mcpConfig");

function detectAgent(cwd) {
  const candidates = [
    ["opencode", join(cwd, ".opencode", "opencode.json")],
    ["opencode", join(cwd, "opencode.json")],
    ["codex", join(cwd, ".codex")],
    ["claude", join(cwd, "CLAUDE.md")],
    ["cursor", join(cwd, ".cursor")],
    ["kimi", join(cwd, ".kimi-code")],
    ["kiro-ide", join(cwd, ".kiro")],
    ["copilot", join(cwd, ".github", "copilot-instructions.md")],
  ];
  const found = candidates.find(([, file]) => existsSync(file));
  return found ? found[0] : "generic";
}

function targetFile(cwd, agent) {
  return resolve(cwd, AGENTS[agent].policy);
}

function applyPolicy(file) {
  const existed = existsSync(file);
  const current = existed ? readFileSync(file, "utf8") : "";
  const block = `${POLICY_MARKER}\n${MEMORY_POLICY}\n${POLICY_END_MARKER}`;
  const start = current.indexOf(POLICY_MARKER);
  const end = current.indexOf(POLICY_END_MARKER);

  if (start !== -1 && end !== -1 && end >= start) {
    const before = current.slice(0, start).replace(/\n+$/, "");
    const after = current.slice(end + POLICY_END_MARKER.length).replace(/^\n+/, "");
    const updated = `${before ? `${before}\n\n` : ""}${block}${after ? `\n\n${after}` : "\n"}`;
    if (updated === current) return { changed: false, existed };
    writeFileSync(file, updated, "utf8");
    return { changed: true, existed };
  }

  const separator = current.trimEnd().length ? "\n\n" : "";
  writeFileSync(file, `${current.trimEnd()}${separator}${block}\n`, "utf8");
  return { changed: true, existed };
}

function installPolicy({ cwd = process.cwd(), agent } = {}) {
  const projectRoot = resolve(cwd);
  const selectedAgent = normalizeAgent(agent);
  const file = targetFile(projectRoot, selectedAgent);
  mkdirSync(dirname(file), { recursive: true });
  const result = applyPolicy(file);
  return { agent: selectedAgent, file, created: !result.existed, changed: result.changed };
}

function install({ cwd = process.cwd(), agent } = {}) {
  const projectRoot = resolve(cwd);
  const selectedAgent = agent ? normalizeAgent(agent) : detectAgent(projectRoot);
  const policy = installPolicy({ cwd: projectRoot, agent: selectedAgent });
  const mcp = installMcpConfig({ cwd: projectRoot, agent: selectedAgent });
  return { ...policy, mcp };
}

module.exports = { AGENTS, detectAgent, installPolicy, install };