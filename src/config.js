const dotenv = require("dotenv");
const { join } = require("node:path");

// Bootstrap único de variables de entorno para todos los módulos runtime.
// Se ejecuta al cargar este módulo, antes de que cualquier consumidor lea
// process.env durante su inicialización.
dotenv.config({ path: join(process.cwd(), ".env"), override: false });

const DEFAULT_PORT = 3000;
const DEFAULT_OWNER = "local-user";
const DEFAULT_QUERY_TIMEOUT_MS = 60000;
const DEFAULT_LLM_TIMEOUT_MS = 30000;
const DEFAULT_LLM_MAX_RETRIES = 2;
const DEFAULT_LLM_RETRY_BASE_DELAY_MS = 250;
const DEFAULT_LLM_RETRY_MAX_DELAY_MS = 2000;
const DEFAULT_TENANT_MAX_CONCURRENT_REQUESTS = 10;
const DEFAULT_TENANT_MAX_SSE_SESSIONS = 10;
const DEFAULT_SEARCH_LIMIT = 50;
const DEFAULT_RECOVER_SESSION_LIMIT = 100;
const DEFAULT_MIN_EMBEDDING_CHARS = 10;
const DEFAULT_MAX_EMBEDDING_CHARS = 2000;
const DEFAULT_EMBEDDING_BATCH_SIZE = 10;
const DEFAULT_EMBEDDING_QUEUE_MAX_SIZE = 1000;
const DEFAULT_EMBEDDING_POLL_INTERVAL_MS = 5000;
const DEFAULT_EMBEDDING_MAX_POLL_INTERVAL_MS = 900000;

const SUPPORTED_AI_PROVIDERS = new Set(["openrouter", "gemini", "google"]);

function readOptionalString(name, fallback = "") {
  const value = process.env[name];
  return value === undefined ? fallback : value.trim();
}

function readPositiveInteger(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} inválido: "${raw}". Debe ser un entero positivo.`);
  }
  return parsed;
}

function readNonNegativeInteger(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} inválido: "${raw}". Debe ser un entero no negativo.`);
  }
  return parsed;
}

function readBoolean(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} inválido: "${raw}". Usá true o false.`);
}

function readAiProvider() {
  const value = readOptionalString("AI_PROVIDER", "").toLowerCase();
  if (value && !SUPPORTED_AI_PROVIDERS.has(value)) {
    throw new Error(`AI_PROVIDER inválido: "${value}". Usá openrouter o gemini.`);
  }
  return value;
}

function readSearchPath() {
  const value = readOptionalString("PG_SEARCH_PATH", "");
  if (value && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`PG_SEARCH_PATH inválido: "${value}".`);
  }
  return value;
}

function getConfig() {
  const minEmbeddingChars = readPositiveInteger("MIN_EMBEDDING_CHARS", DEFAULT_MIN_EMBEDDING_CHARS);
  const maxEmbeddingChars = readPositiveInteger("MAX_EMBEDDING_CHARS", DEFAULT_MAX_EMBEDDING_CHARS);

  if (maxEmbeddingChars < minEmbeddingChars) {
    throw new Error("MAX_EMBEDDING_CHARS no puede ser menor que MIN_EMBEDDING_CHARS.");
  }

  return {
    server: {
      port: readPositiveInteger("PORT", DEFAULT_PORT),
      allowedHosts: readOptionalString("MCP_ALLOWED_HOSTS", "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean),
      allowedOrigins: readOptionalString("MCP_ALLOWED_ORIGINS", "").split(",").map((value) => value.trim().replace(/\/$/, "").toLowerCase()).filter(Boolean),
      bearerToken: readOptionalString("MCP_BEARER_TOKEN", ""),
      tenantMaxConcurrentRequests: readPositiveInteger(
        "MCP_TENANT_MAX_CONCURRENT_REQUESTS",
        DEFAULT_TENANT_MAX_CONCURRENT_REQUESTS,
      ),
      tenantMaxSseSessions: readPositiveInteger(
        "MCP_TENANT_MAX_SSE_SESSIONS",
        DEFAULT_TENANT_MAX_SSE_SESSIONS,
      ),
      enableEmbeddingWorkerHttp: readBoolean("ENABLE_EMBEDDING_WORKER", false),
      enableEmbeddingWorkerStdio: readBoolean("ENABLE_EMBEDDING_WORKER", true),
    },
    database: {
      defaultOwner: readOptionalString("MCP_DEFAULT_OWNER", DEFAULT_OWNER) || DEFAULT_OWNER,
      queryTimeoutMs: readPositiveInteger("CONVERSATION_MEMORY_QUERY_TIMEOUT_MS", DEFAULT_QUERY_TIMEOUT_MS),
      connectTimeoutMs: readPositiveInteger("CONVERSATION_MEMORY_CONNECT_TIMEOUT_MS", 10000),
      keepaliveDelayMs: readPositiveInteger("CONVERSATION_MEMORY_KEEPALIVE_DELAY_MS", 30000),
      searchPath: readSearchPath(),
      sslRejectUnauthorized: readBoolean("PGSSL_REJECT_UNAUTHORIZED", true),
    },
    embeddings: {
      enabled: readBoolean("ENABLE_EMBEDDINGS", true),
      minChars: minEmbeddingChars,
      maxChars: maxEmbeddingChars,
      batchSize: readPositiveInteger("EMBEDDING_BATCH_SIZE", DEFAULT_EMBEDDING_BATCH_SIZE),
      queueMaxSize: readPositiveInteger("EMBEDDING_QUEUE_MAX_SIZE", DEFAULT_EMBEDDING_QUEUE_MAX_SIZE),
      pollIntervalMs: readPositiveInteger("EMBEDDING_POLL_INTERVAL_MS", DEFAULT_EMBEDDING_POLL_INTERVAL_MS),
      maxPollIntervalMs: readPositiveInteger("EMBEDDING_MAX_POLL_INTERVAL_MS", DEFAULT_EMBEDDING_MAX_POLL_INTERVAL_MS),
    },
    searchLimit: readPositiveInteger("SEARCH_MESSAGES_LIMIT", DEFAULT_SEARCH_LIMIT),
    recoverSessionLimit: readPositiveInteger("RECOVER_SESSION_LIMIT", DEFAULT_RECOVER_SESSION_LIMIT),
    llm: {
      provider: readAiProvider(),
      model: readOptionalString("AI_MODEL", ""),
      openrouterApiKey: readOptionalString("OPENROUTER_API_KEY", ""),
      geminiApiKey: readOptionalString("GEMINI_API_KEY", ""),
      timeoutMs: readPositiveInteger("CONVERSATION_MEMORY_LLM_TIMEOUT_MS", DEFAULT_LLM_TIMEOUT_MS),
      maxRetries: readNonNegativeInteger("CONVERSATION_MEMORY_LLM_MAX_RETRIES", DEFAULT_LLM_MAX_RETRIES),
      retryBaseDelayMs: readNonNegativeInteger("CONVERSATION_MEMORY_LLM_RETRY_BASE_DELAY_MS", DEFAULT_LLM_RETRY_BASE_DELAY_MS),
      retryMaxDelayMs: readNonNegativeInteger("CONVERSATION_MEMORY_LLM_RETRY_MAX_DELAY_MS", DEFAULT_LLM_RETRY_MAX_DELAY_MS),
    },
  };
}

const config = getConfig();

module.exports = {
  getConfig,
  config,
  SUPPORTED_AI_PROVIDERS,
  DEFAULT_PORT,
  DEFAULT_OWNER,
  DEFAULT_QUERY_TIMEOUT_MS,
  DEFAULT_LLM_TIMEOUT_MS,
  DEFAULT_LLM_MAX_RETRIES,
  DEFAULT_LLM_RETRY_BASE_DELAY_MS,
  DEFAULT_LLM_RETRY_MAX_DELAY_MS,
  DEFAULT_TENANT_MAX_CONCURRENT_REQUESTS,
  DEFAULT_TENANT_MAX_SSE_SESSIONS,
  DEFAULT_MIN_EMBEDDING_CHARS,
  DEFAULT_MAX_EMBEDDING_CHARS,
  DEFAULT_EMBEDDING_BATCH_SIZE,
  DEFAULT_EMBEDDING_QUEUE_MAX_SIZE,
  DEFAULT_EMBEDDING_POLL_INTERVAL_MS,
  DEFAULT_EMBEDDING_MAX_POLL_INTERVAL_MS,
};
