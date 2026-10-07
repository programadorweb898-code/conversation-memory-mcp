const { expect } = require("chai");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { getConfig } = require("../src/config");

describe("centralized runtime configuration", () => {
  const keys = [
    "PORT",
    "MCP_DEFAULT_OWNER",
    "MCP_TENANT_MAX_CONCURRENT_REQUESTS",
    "MCP_TENANT_MAX_SSE_SESSIONS",
    "SEARCH_MESSAGES_LIMIT",
    "RECOVER_SESSION_LIMIT",
    "CONVERSATION_MEMORY_QUERY_TIMEOUT_MS",
    "CONVERSATION_MEMORY_CONNECT_TIMEOUT_MS",
    "CONVERSATION_MEMORY_KEEPALIVE_DELAY_MS",
    "ENABLE_EMBEDDINGS",
    "ENABLE_EMBEDDING_WORKER",
    "MIN_EMBEDDING_CHARS",
    "MAX_EMBEDDING_CHARS",
    "EMBEDDING_BATCH_SIZE",
    "EMBEDDING_QUEUE_MAX_SIZE",
    "EMBEDDING_POLL_INTERVAL_MS",
    "EMBEDDING_MAX_POLL_INTERVAL_MS",
    "AI_PROVIDER",
    "OPENROUTER_API_KEY",
    "GEMINI_API_KEY",
    "AI_MODEL",
    "CONVERSATION_MEMORY_LLM_TIMEOUT_MS",
    "CONVERSATION_MEMORY_LLM_MAX_RETRIES",
    "CONVERSATION_MEMORY_LLM_RETRY_BASE_DELAY_MS",
    "CONVERSATION_MEMORY_LLM_RETRY_MAX_DELAY_MS",
    "PG_SEARCH_PATH",
    "PGSSL_REJECT_UNAUTHORIZED",
    "MCP_ALLOWED_HOSTS",
    "MCP_ALLOWED_ORIGINS",
  ];
  const original = {};

  beforeEach(() => {
    for (const key of keys) {
      original[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it("carga .env antes de que otro módulo consulte la configuración", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "conversation-memory-config-"));
    const configPath = path.resolve(__dirname, "../src/config.js");

    try {
      fs.writeFileSync(path.join(tempDir, ".env"), "PORT=4567\nMCP_DEFAULT_OWNER=bootstrap-owner\n");

      const childEnv = { ...process.env };
      delete childEnv.PORT;
      delete childEnv.MCP_DEFAULT_OWNER;

      const script = `const { getConfig } = require(${JSON.stringify(configPath)}); process.stdout.write(JSON.stringify(getConfig().server.port) + "|" + getConfig().database.defaultOwner);`;
      const result = spawnSync(process.execPath, ["-e", script], {
        cwd: tempDir,
        env: { ...childEnv, DOTENV_CONFIG_QUIET: "true" },
        encoding: "utf8",
      });

      expect(result.status).to.equal(0, result.stderr);
      expect(result.stdout).to.equal("4567|bootstrap-owner");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
  it("aplica defaults consistentes", () => {
    const config = getConfig();

    expect(config.server.port).to.equal(3000);
    expect(config.server.tenantMaxConcurrentRequests).to.equal(10);
    expect(config.server.tenantMaxSseSessions).to.equal(10);
    expect(config.searchLimit).to.equal(50);
    expect(config.recoverSessionLimit).to.equal(100);
    expect(config.database.defaultOwner).to.equal("local-user");
    expect(config.database.queryTimeoutMs).to.equal(60000);
    expect(config.database.connectTimeoutMs).to.equal(10000);
    expect(config.database.keepaliveDelayMs).to.equal(30000);

    expect(config.embeddings.enabled).to.equal(true);
    expect(config.embeddings.batchSize).to.equal(10);
    expect(config.embeddings.queueMaxSize).to.equal(1000);
    expect(config.embeddings.pollIntervalMs).to.equal(5000);
    expect(config.embeddings.maxPollIntervalMs).to.equal(900000);

    expect(config.llm.timeoutMs).to.equal(30000);
    expect(config.llm.maxRetries).to.equal(2);
    expect(config.llm.retryBaseDelayMs).to.equal(250);
    expect(config.llm.retryMaxDelayMs).to.equal(2000);
  });

  it("convierte y agrupa las variables de entorno", () => {
    Object.assign(process.env, {
      PORT: "4100",
      MCP_DEFAULT_OWNER: "owner-a",
      MCP_TENANT_MAX_CONCURRENT_REQUESTS: "7",
      MCP_TENANT_MAX_SSE_SESSIONS: "4",
      SEARCH_MESSAGES_LIMIT: "25",
      RECOVER_SESSION_LIMIT: "75",
      CONVERSATION_MEMORY_QUERY_TIMEOUT_MS: "70000",
      CONVERSATION_MEMORY_CONNECT_TIMEOUT_MS: "1200",
      CONVERSATION_MEMORY_KEEPALIVE_DELAY_MS: "5000",
      ENABLE_EMBEDDINGS: "false",
      ENABLE_EMBEDDING_WORKER: "true",
      MIN_EMBEDDING_CHARS: "20",
      MAX_EMBEDDING_CHARS: "1500",
      EMBEDDING_BATCH_SIZE: "8",
      EMBEDDING_QUEUE_MAX_SIZE: "50",
      EMBEDDING_POLL_INTERVAL_MS: "1000",
      EMBEDDING_MAX_POLL_INTERVAL_MS: "60000",
      AI_PROVIDER: "openrouter",
      AI_MODEL: "example/model",
      OPENROUTER_API_KEY: "secret",
      GEMINI_API_KEY: "gemini-secret",
      CONVERSATION_MEMORY_LLM_TIMEOUT_MS: "9000",
      CONVERSATION_MEMORY_LLM_MAX_RETRIES: "3",
      CONVERSATION_MEMORY_LLM_RETRY_BASE_DELAY_MS: "100",
      CONVERSATION_MEMORY_LLM_RETRY_MAX_DELAY_MS: "1000",
      PG_SEARCH_PATH: "cm_test",
      PGSSL_REJECT_UNAUTHORIZED: "false",
    });

    const config = getConfig();

    expect(config.server.port).to.equal(4100);
    expect(config.server.tenantMaxConcurrentRequests).to.equal(7);
    expect(config.server.tenantMaxSseSessions).to.equal(4);
    expect(config.searchLimit).to.equal(25);
    expect(config.recoverSessionLimit).to.equal(75);
    expect(config.server.bearerToken).to.equal("");
    expect(config.server.enableEmbeddingWorkerHttp).to.equal(true);
    expect(config.server.enableEmbeddingWorkerStdio).to.equal(true);

    expect(config.database.defaultOwner).to.equal("owner-a");
    expect(config.database.queryTimeoutMs).to.equal(70000);
    expect(config.database.searchPath).to.equal("cm_test");
    expect(config.database.sslRejectUnauthorized).to.equal(false);

    expect(config.embeddings.enabled).to.equal(false);
    expect(config.embeddings.minChars).to.equal(20);
    expect(config.embeddings.maxChars).to.equal(1500);
    expect(config.embeddings.batchSize).to.equal(8);
    expect(config.embeddings.queueMaxSize).to.equal(50);

    expect(config.llm.provider).to.equal("openrouter");
    expect(config.llm.model).to.equal("example/model");
    expect(config.llm.openrouterApiKey).to.equal("secret");
    expect(config.llm.geminiApiKey).to.equal("gemini-secret");
    expect(config.llm.timeoutMs).to.equal(9000);
    expect(config.llm.maxRetries).to.equal(3);
    expect(config.llm.retryBaseDelayMs).to.equal(100);
    expect(config.llm.retryMaxDelayMs).to.equal(1000);
  });

  it("normaliza las listas de Host y Origin para la protección MCP", () => {
    process.env.MCP_ALLOWED_HOSTS = " Allowed.Example,SECOND.example ";
    process.env.MCP_ALLOWED_ORIGINS = " https://Allowed.Example/,https://second.example ";

    const config = getConfig();

    expect(config.server.allowedHosts).to.deep.equal([
      "allowed.example",
      "second.example",
    ]);
    expect(config.server.allowedOrigins).to.deep.equal([
      "https://allowed.example",
      "https://second.example",
    ]);
  });

  it("falla rápido ante configuración inválida", () => {
    process.env.PORT = "-1";
    expect(() => getConfig()).to.throw("PORT inválido");

    process.env.PORT = "0";
    expect(getConfig().server.port).to.equal(0);

    delete process.env.PORT;
    process.env.SEARCH_MESSAGES_LIMIT = "0";
    expect(() => getConfig()).to.throw("SEARCH_MESSAGES_LIMIT inválido");

    delete process.env.SEARCH_MESSAGES_LIMIT;
    process.env.ENABLE_EMBEDDINGS = "yes";
    expect(() => getConfig()).to.throw("ENABLE_EMBEDDINGS inválido");

    delete process.env.ENABLE_EMBEDDINGS;
    process.env.PG_SEARCH_PATH = "public;DROP TABLE conversations";
    expect(() => getConfig()).to.throw("PG_SEARCH_PATH inválido");

    delete process.env.PG_SEARCH_PATH;
    process.env.MAX_EMBEDDING_CHARS = "5";
    process.env.MIN_EMBEDDING_CHARS = "10";
    expect(() => getConfig()).to.throw("MAX_EMBEDDING_CHARS no puede ser menor");
  });
});