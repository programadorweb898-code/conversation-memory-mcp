const { readFileSync } = require("node:fs");
const { homedir } = require("node:os");
const { join, dirname } = require("node:path");
const { parse } = require("jsonc-parser");

function template(value) {
  return String(value).replace(/\{env:([A-Z0-9_]+)\}/g, (_, name) => process.env[name] ?? "");
}
function findMcpConfig(directory, { configDir = process.env.OPENCODE_CONFIG_DIR || join(homedir(), ".config", "opencode") } = {}) {
  if (process.env.CONVERSATION_MEMORY_URL && process.env.CONVERSATION_MEMORY_TOKEN) {
    return { kind: "remote", url: template(process.env.CONVERSATION_MEMORY_URL), token: process.env.CONVERSATION_MEMORY_TOKEN };
  }
  const ancestors = [];
  for (let dir = directory; dir; dir = dirname(dir)) {
    ancestors.unshift(dir);
    if (dirname(dir) === dir) break;
  }
  const candidates = [join(configDir, "opencode.json"), join(configDir, "opencode.jsonc"),
    ...ancestors.flatMap(dir => [join(dir, "opencode.json"), join(dir, "opencode.jsonc")]),
    ...ancestors.flatMap(dir => [join(dir, ".opencode", "opencode.json"), join(dir, ".opencode", "opencode.jsonc")]),
    ...(process.env.OPENCODE_CONFIG ? [process.env.OPENCODE_CONFIG] : [])];
  const servers = {};
  let selectedName;
  function apply(config) {
    const map = config?.mcp?.servers || config?.mcp;
    if (!map) return;
    for (const name of ["conversation-memory-local", "conversation-memory"]) {
      if (!Object.hasOwn(map, name)) continue;
      const entry = map[name];
      const previous = servers[name] || {};
      servers[name] = { ...previous, ...entry,
        environment: { ...previous.environment, ...entry?.environment },
        headers: { ...previous.headers, ...entry?.headers } };
    }
    if (Object.hasOwn(map, "conversation-memory-local")) selectedName = "conversation-memory-local";
    else if (Object.hasOwn(map, "conversation-memory")) selectedName = "conversation-memory";
  }
  for (const file of candidates) {
    let source;
    try { source = readFileSync(file, "utf8"); }
    catch (error) { if (["ENOENT", "ENOTDIR"].includes(error.code)) continue; throw error; }
    const errors = [];
    const config = parse(source.replace(/^\uFEFF/, ""), errors, { allowTrailingComma: true });
    if (errors.length) throw new Error(`Invalid OpenCode config: ${file}`);
    apply(config);
  }
  if (process.env.OPENCODE_CONFIG_CONTENT) {
    const errors = [];
    const content = parse(process.env.OPENCODE_CONFIG_CONTENT, errors, { allowTrailingComma: true });
    if (errors.length) throw new Error("Invalid OPENCODE_CONFIG_CONTENT");
    apply(content);
  }
  const entry = servers[selectedName];
  if (!entry || entry.enabled === false) return null;
  if (entry.command) {
    const command = Array.isArray(entry.command) ? entry.command : [entry.command, ...(entry.args || [])];
    const env = {};
    for (const name of ["CONVERSATION_MEMORY_DATABASE_URL", "MCP_DEFAULT_OWNER"]) {
      if (process.env[name]) env[name] = process.env[name];
    }
    for (const [key, value] of Object.entries(entry.environment || {})) env[key] = template(value);
    return { kind: "local", command: command[0], args: command.slice(1), env, cwd: entry.cwd || directory };
  }
  if (entry.url) {
    const auth = template(entry.headers?.Authorization ?? entry.headers?.authorization ?? "");
    return { kind: "remote", url: template(entry.url), token: auth.startsWith("Bearer ") ? auth.slice(7) : "" };
  }
  return null;
}
module.exports = { findMcpConfig };
