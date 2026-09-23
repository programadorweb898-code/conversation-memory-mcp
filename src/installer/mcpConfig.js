const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { dirname, join, resolve } = require("node:path");

const SERVER_NAME = "conversation-memory";

const AGENTS = {
  generic: { policy: "AGENTS.md", config: null },
  opencode: { policy: "AGENTS.md", config: "opencode" },
  codex: { policy: "AGENTS.md", config: "codex" },
  claude: { policy: "CLAUDE.md", config: "claude" },
  copilot: { policy: ".github/copilot-instructions.md", config: "vscode" },
  "vscode-copilot": { policy: ".github/copilot-instructions.md", config: "vscode" },
  cursor: { policy: "AGENTS.md", config: "cursor" },
  kimi: { policy: "AGENTS.md", config: "kimi" },
  "kimi-code": { policy: "AGENTS.md", config: "kimi" },
  "gemini-cli": { policy: "GEMINI.md", config: null },
  "qwen-code": { policy: "AGENTS.md", config: null },
  kilocode: { policy: "AGENTS.md", config: "opencode" },
  "kiro-ide": { policy: "AGENTS.md", config: "kiro" },
  windsurf: { policy: "AGENTS.md", config: null },
  antigravity: { policy: "GEMINI.md", config: null },
  openclaw: { policy: "AGENTS.md", config: null },
  trae: { policy: "AGENTS.md", config: null },
  pi: { policy: "AGENTS.md", config: null },
  hermes: { policy: "AGENTS.md", config: null },
};

function normalizeAgent(value) {
  if (!value) return "generic";
  const agent = value.toLowerCase();
  if (!Object.hasOwn(AGENTS, agent)) {
    throw new Error(`Agente no soportado: ${value}. Opciones: ${Object.keys(AGENTS).join(", ")}`);
  }
  return agent;
}

function readJson(file) {
  if (!existsSync(file)) return {};
  const content = readFileSync(file, "utf8").trim();
  return content ? JSON.parse(content) : {};
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function mergeJsonServer(file, rootPath, server) {
  const config = readJson(file);
  const parts = rootPath.split(".");
  let cursor = config;
  for (const part of parts) {
    cursor[part] = cursor[part] || {};
    cursor = cursor[part];
  }
  const current = cursor[SERVER_NAME];
  const next = { ...(current || {}), ...server };
  if (JSON.stringify(current) === JSON.stringify(next)) return { changed: false, file, supported: true };
  cursor[SERVER_NAME] = next;
  writeJson(file, config);
  return { changed: true, file, supported: true };
}

function installOpenCode(cwd) {
  return mergeJsonServer(join(cwd, ".opencode", "opencode.json"), "mcp.servers", {
    type: "local",
    command: ["npx", "-y", "conversation-memory-mcp"],
  });
}

function installStandardMcpJson(cwd, file, rootPath = "mcpServers") {
  return mergeJsonServer(file, rootPath, {
    command: "npx",
    args: ["-y", "conversation-memory-mcp"],
  });
}

function installCodex(cwd) {
  const file = join(cwd, ".codex", "config.toml");
  mkdirSync(dirname(file), { recursive: true });
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  const header = `[mcp_servers.conversation-memory]\ncommand = "npx"\nargs = ["-y", "conversation-memory-mcp"]\n`;
  const section = /^\[mcp_servers\.conversation-memory\][\s\S]*?(?=^\[|$)/m;
  const match = current.match(section);
  const updated = match
    ? current.replace(match[0], header)
    : `${current.trimEnd()}${current.trimEnd() ? "\n\n" : ""}${header}\n`;
  if (updated === current) return { changed: false, file, supported: true };
  writeFileSync(file, updated, "utf8");
  return { changed: true, file, supported: true };
}

function installMcpConfig({ cwd = process.cwd(), agent } = {}) {
  const projectRoot = resolve(cwd);
  switch (AGENTS[agent].config) {
    case "opencode":
      return installOpenCode(projectRoot);
    case "codex":
      return installCodex(projectRoot);
    case "claude":
      return installStandardMcpJson(projectRoot, join(projectRoot, ".mcp.json"));
    case "cursor":
      return installStandardMcpJson(projectRoot, join(projectRoot, ".cursor", "mcp.json"));
    case "kimi":
      return installStandardMcpJson(projectRoot, join(projectRoot, ".kimi-code", "mcp.json"));
    case "kiro":
      return installStandardMcpJson(projectRoot, join(projectRoot, ".kiro", "settings", "mcp.json"));
    case "vscode":
      return installStandardMcpJson(projectRoot, join(projectRoot, ".mcp.json"), "servers");
    default:
      return { changed: false, file: null, supported: false };
  }
}

module.exports = { AGENTS, normalizeAgent, installMcpConfig };
