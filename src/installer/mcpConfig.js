const { sync: execFileSync } = require("cross-spawn");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { homedir } = require("node:os");
const { dirname, join, resolve } = require("node:path");

const { readConfig, updateConfig } = require("./configFiles");
const { installOpenCode } = require("./opencode");
const { isDeepStrictEqual } = require("node:util");
const TOML = require("@iarna/toml");

const SERVER_NAME = "conversation-memory";

const AGENTS = {
  generic: { policy: "AGENTS.md", config: null },
  opencode: { policy: "AGENTS.md", config: "opencode" },
  codex: { policy: "AGENTS.md", config: "codex" },
  claude: { policy: "CLAUDE.md", config: "claude", supportsGlobal: true },
  copilot: { policy: ".github/copilot-instructions.md", config: "vscode" },
  "vscode-copilot": { policy: ".github/copilot-instructions.md", config: "vscode" },
  "github-copilot": { policy: ".github/copilot-instructions.md", config: "github-copilot", supportsGlobal: true },
  cursor: { policy: "AGENTS.md", config: "cursor", supportsGlobal: true },
  kimi: { policy: "AGENTS.md", config: "kimi" },
  "kimi-code": { policy: "AGENTS.md", config: "kimi" },
  "gemini-cli": { policy: "GEMINI.md", config: "gemini", supportsGlobal: true },
  "qwen-code": { policy: "AGENTS.md", config: "qwen", supportsGlobal: true },
  kilocode: { policy: "AGENTS.md", config: "kilo" },
  "kiro-ide": { policy: "AGENTS.md", config: "kiro" },
  windsurf: { policy: "AGENTS.md", config: "windsurf", globalOnly: true },
  antigravity: { policy: "GEMINI.md", config: "antigravity", supportsGlobal: true },
  openclaw: { policy: "AGENTS.md", config: "openclaw", globalOnly: true },
  trae: { policy: "AGENTS.md", config: null },
  "trae-cn": { policy: "AGENTS.md", config: null },
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

function mergeJsonServer(file, rootPath, server) {
  const config = readConfig(file).value;
  const parts = rootPath.split(".");
  let current = config;
  for (const part of parts) current = current?.[part];
  current = current?.[SERVER_NAME];
  const next = { ...(current || {}), ...server };
  if (JSON.stringify(current) === JSON.stringify(next)) return { changed: false, file, supported: true };
  const changed = updateConfig(file, [...parts, SERVER_NAME], next);
  return { changed, file, supported: true };
}

function installKilo(cwd) {
  const command = process.platform === "win32"
    ? ["cmd", "/c", "npx", "-y", "conversation-memory-mcp"]
    : ["npx", "-y", "conversation-memory-mcp"];

  return mergeJsonServer(join(cwd, ".kilo", "kilo.jsonc"), "mcp", {
    type: "local",
    command,
    enabled: true,
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
  // Parse TOML instead of matching a section up to the first multiline `$`.
  // Preserve every other setting, including env, trust and other MCP servers.
  const config = current.trim() ? TOML.parse(current) : {};
  config.mcp_servers ??= {};
  const previous = config.mcp_servers[SERVER_NAME] || {};
  if (previous.command === "npx" && JSON.stringify(previous.args) === JSON.stringify(["-y", "conversation-memory-mcp"])) {
    return { changed: false, file, supported: true };
  }
  config.mcp_servers[SERVER_NAME] = { ...previous, command: "npx", args: ["-y", "conversation-memory-mcp"] };
  const replacement = TOML.stringify({ mcp_servers: { [SERVER_NAME]: config.mcp_servers[SERVER_NAME] } });
  // Replace only this server and its subtables. Leave unrelated comments intact.
  const blocks = current.split(/(?=^\s*\[)/m);
  let inserted = false;
  let updated = blocks.map(block => {
    if (!/^\s*\[mcp_servers\.(?:conversation-memory|"conversation-memory")(?:\]|\.)/.test(block)) return block;
    if (inserted) return "";
    inserted = true;
    return replacement + "\n";
  }).join("") + (inserted ? "" : `${current.trim() ? "\n" : ""}${replacement}`);
  try {
    if (!isDeepStrictEqual(TOML.parse(updated), config)) updated = TOML.stringify(config);
  } catch { updated = TOML.stringify(config); }
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

function installQwen(cwd, scope, homeDir = homedir()) {
  const normalizedScope = normalizeScope(scope);
  const file = normalizedScope === "global"
    ? join(homeDir, ".qwen", "settings.json")
    : join(cwd, ".qwen", "settings.json");

  return {
    ...mergeJsonServer(file, "mcpServers", {
      command: "npx",
      args: ["-y", "conversation-memory-mcp"],
    }),
    scope: normalizedScope,
  };
}

function installWindsurf(scope, homeDir = homedir()) {
  const normalizedScope = normalizeScope(scope);
  if (normalizedScope !== "global") {
    throw new Error("Windsurf administra sus servidores MCP en una configuración global; use --scope global.");
  }

  const file = join(homeDir, ".codeium", "windsurf", "mcp_config.json");

  return {
    ...mergeJsonServer(file, "mcpServers", {
      command: "npx",
      args: ["-y", "conversation-memory-mcp"],
    }),
    scope: normalizedScope,
  };
}

function installAntigravity(cwd, scope, homeDir = homedir()) {
  const normalizedScope = normalizeScope(scope);
  const file = normalizedScope === "global"
    ? join(homeDir, ".gemini", "config", "mcp_config.json")
    : join(cwd, ".agents", "mcp_config.json");

  return {
    ...mergeJsonServer(file, "mcpServers", {
      command: "npx",
      args: ["-y", "conversation-memory-mcp"],
    }),
    scope: normalizedScope,
  };
}

function installGitHubCopilot(scope, homeDir = homedir(), commandRunner = execFileSync) {
  const normalizedScope = normalizeScope(scope);

  if (normalizedScope === "project") {
    return {
      ...installStandardMcpJson(process.cwd(), join(process.cwd(), ".mcp.json")),
      scope: normalizedScope,
    };
  }

  const file = join(homeDir, ".copilot", "mcp-config.json");
  const executable = process.platform === "win32" ? "copilot.cmd" : "copilot";

  commandRunner(
    executable,
    ["mcp", "add", SERVER_NAME, "--", "npx", "-y", "conversation-memory-mcp"],
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

function installMcpConfig({ cwd = process.cwd(), agent, scope, homeDir = homedir(), commandRunner = execFileSync, opencodeVersion } = {}) {
  const projectRoot = resolve(cwd);
  const selectedAgent = normalizeAgent(agent);
  const normalizedScope = resolveScope(selectedAgent, scope);

  switch (AGENTS[selectedAgent].config) {
    case "opencode":
      if (normalizedScope !== "project") throw new Error("OpenCode solo admite scope project en este instalador.");
      return installOpenCode({ cwd: projectRoot, homeDir, version: opencodeVersion, commandRunner });
    case "kilo":
      return installKilo(projectRoot);
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
    case "github-copilot":
      if (normalizedScope === "project") {
        return {
          ...installStandardMcpJson(projectRoot, join(projectRoot, ".mcp.json")),
          scope: normalizedScope,
        };
      }
      return installGitHubCopilot(normalizedScope, homeDir, commandRunner);
    case "qwen":
      return installQwen(projectRoot, normalizedScope, homeDir);
    case "windsurf":
      return installWindsurf(normalizedScope, homeDir);
    case "antigravity":
      return installAntigravity(projectRoot, normalizedScope, homeDir);
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
