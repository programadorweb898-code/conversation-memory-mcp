const { execFileSync } = require("node:child_process");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { homedir } = require("node:os");
const { dirname, join, resolve } = require("node:path");

const SERVER_NAME = "conversation-memory";

const AGENTS = {
  generic: { policy: "AGENTS.md", config: null },
  opencode: { policy: "AGENTS.md", config: "opencode" },
  codex: { policy: "AGENTS.md", config: "codex" },
  claude: { policy: "CLAUDE.md", config: "claude", supportsGlobal: true },
  copilot: { policy: ".github/copilot-instructions.md", config: "vscode" },
  "vscode-copilot": { policy: ".github/copilot-instructions.md", config: "vscode" },
  cursor: { policy: "AGENTS.md", config: "cursor", supportsGlobal: true },
  kimi: { policy: "AGENTS.md", config: "kimi" },
  "kimi-code": { policy: "AGENTS.md", config: "kimi" },
  "gemini-cli": { policy: "GEMINI.md", config: "gemini", supportsGlobal: true },
  "qwen-code": { policy: "AGENTS.md", config: null },
  kilocode: { policy: "AGENTS.md", config: "opencode" },
  "kiro-ide": { policy: "AGENTS.md", config: "kiro" },
  windsurf: { policy: "AGENTS.md", config: null },
  antigravity: { policy: "GEMINI.md", config: null },
  openclaw: { policy: "AGENTS.md", config: "openclaw", globalOnly: true },
  trae: { policy: "AGENTS.md", config: null },
  pi: { policy: "AGENTS.md", config: null },
  hermes: { policy: "AGENTS.md", config: "hermes", globalOnly: true },
};

function normalizeAgent(value) {
  if (!value) return "generic";
  const agent = value.toLowerCase();
  if (!Object.hasOwn(AGENTS, agent)) {
    throw new Error(`Agente no soportado: ${value}. Opciones: ${Object.keys(AGENTS).join(", ")}`);
  }
  return agent;
}

function normalizeScope(value) {
  const scope = (value || "project").toLowerCase();
  if (scope !== "project" && scope !== "global") {
    throw new Error(`Scope no soportado: ${value}. Opciones: project, global`);
  }
  return scope;
}

function getDefaultScope(agent) {
  const selectedAgent = normalizeAgent(agent);
  return AGENTS[selectedAgent].globalOnly ? "global" : "project";
}

function resolveScope(agent, scope) {
  const selectedAgent = normalizeAgent(agent);
  if (scope == null) return getDefaultScope(selectedAgent);
  return normalizeScope(scope);
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

function installVsCode(cwd) {
  return mergeJsonServer(join(cwd, ".vscode", "mcp.json"), "servers", {
    type: "stdio",
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

function installGemini(cwd, scope, homeDir = homedir()) {
  const normalizedScope = normalizeScope(scope);
  const file = normalizedScope === "global"
    ? join(homeDir, ".gemini", "settings.json")
    : join(cwd, ".gemini", "settings.json");

  return {
    ...mergeJsonServer(file, "mcpServers", {
      command: "npx",
      args: ["-y", "conversation-memory-mcp"],
    }),
    scope: normalizedScope,
  };
}

function installClaude(cwd, scope, homeDir = homedir()) {
  const normalizedScope = normalizeScope(scope);
  const file = normalizedScope === "global"
    ? join(homeDir, ".claude.json")
    : join(cwd, ".mcp.json");

  return {
    ...mergeJsonServer(file, "mcpServers", {
      command: "npx",
      args: ["-y", "conversation-memory-mcp"],
    }),
    scope: normalizedScope,
  };
}

function installCursor(cwd, scope, homeDir = homedir()) {
  const normalizedScope = normalizeScope(scope);
  const file = normalizedScope === "global"
    ? join(homeDir, ".cursor", "mcp.json")
    : join(cwd, ".cursor", "mcp.json");

  return {
    ...mergeJsonServer(file, "mcpServers", {
      command: "npx",
      args: ["-y", "conversation-memory-mcp"],
    }),
    scope: normalizedScope,
  };
}

function installOpenClaw(scope, homeDir = homedir(), commandRunner = execFileSync) {
  const normalizedScope = normalizeScope(scope);
  if (normalizedScope !== "global") {
    throw new Error("OpenClaw administra sus servidores MCP en una configuración central; use --scope global.");
  }

  const file = process.env.OPENCLAW_CONFIG_PATH || join(homeDir, ".openclaw", "openclaw.json");
  const executable = process.platform === "win32" ? "openclaw.cmd" : "openclaw";
  const server = JSON.stringify({
    command: "npx",
    args: ["-y", "conversation-memory-mcp"],
  });

  commandRunner(executable, ["mcp", "set", SERVER_NAME, server], {
    stdio: "ignore",
    windowsHide: true,
  });

  return {
    changed: true,
    file,
    supported: true,
    scope: normalizedScope,
  };
}

function installHermes(scope, homeDir = homedir(), commandRunner = execFileSync) {
  const normalizedScope = normalizeScope(scope);
  if (normalizedScope !== "global") {
    throw new Error("Hermes administra sus servidores MCP en una configuración central; use --scope global.");
  }

  const hermesHome = process.env.HERMES_HOME || join(homeDir, ".hermes");
  const file = join(hermesHome, "config.yaml");
  const executable = process.platform === "win32" ? "hermes.exe" : "hermes";

  commandRunner(
    executable,
    ["mcp", "add", SERVER_NAME, "--command", "npx", "--args", "-y", "conversation-memory-mcp"],
    {
      stdio: "ignore",
      windowsHide: true,
    },
  );

  return {
    changed: true,
    file,
    supported: true,
    scope: normalizedScope,
  };
}

function installMcpConfig({ cwd = process.cwd(), agent, scope, homeDir = homedir(), commandRunner = execFileSync } = {}) {
  const projectRoot = resolve(cwd);
  const selectedAgent = normalizeAgent(agent);
  const normalizedScope = resolveScope(selectedAgent, scope);

  switch (AGENTS[selectedAgent].config) {
    case "opencode":
      return installOpenCode(projectRoot);
    case "codex":
      return installCodex(projectRoot);
    case "claude":
      return installClaude(projectRoot, normalizedScope, homeDir);
    case "cursor":
      return installCursor(projectRoot, normalizedScope, homeDir);
    case "kimi":
      return installStandardMcpJson(projectRoot, join(projectRoot, ".kimi-code", "mcp.json"));
    case "kiro":
      return installStandardMcpJson(projectRoot, join(projectRoot, ".kiro", "settings", "mcp.json"));
    case "vscode":
      return installVsCode(projectRoot);
    case "gemini":
      return installGemini(projectRoot, normalizedScope, homeDir);
    case "openclaw":
      return installOpenClaw(normalizedScope, homeDir, commandRunner);
    case "hermes":
      return installHermes(normalizedScope, homeDir, commandRunner);
    default:
      return { changed: false, file: null, supported: false };
  }
}

module.exports = {
  AGENTS,
  getDefaultScope,
  normalizeAgent,
  normalizeScope,
  resolveScope,
  installMcpConfig,
};
