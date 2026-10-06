const DEFAULT_RECOVER_SESSION_LIMIT = 100;
const DEFAULT_SEARCH_LIMIT = 50;
const DEFAULT_LLM_TIMEOUT_MS = 30000;
const DEFAULT_LLM_RETRIES = 2;

function positiveInteger(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(name + " inválido: \"" + raw + "\"");
  return value;
}
function csv(name) {
  return (process.env[name] || "").split(",").map(v => v.trim()).filter(Boolean);
}
const config = {
  recoverSessionLimit: positiveInteger("RECOVER_SESSION_LIMIT", DEFAULT_RECOVER_SESSION_LIMIT),
  searchLimit: positiveInteger("SEARCH_MESSAGES_LIMIT", DEFAULT_SEARCH_LIMIT),
  llmTimeoutMs: positiveInteger("LLM_TIMEOUT_MS", DEFAULT_LLM_TIMEOUT_MS),
  llmRetries: positiveInteger("LLM_MAX_RETRIES", DEFAULT_LLM_RETRIES),
  allowedHosts: csv("MCP_ALLOWED_HOSTS"),
  allowedOrigins: csv("MCP_ALLOWED_ORIGINS"),
};
module.exports = { config, DEFAULT_RECOVER_SESSION_LIMIT, DEFAULT_SEARCH_LIMIT, DEFAULT_LLM_TIMEOUT_MS, DEFAULT_LLM_RETRIES };