const { expect } = require("chai");
const sinon = require("sinon");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const llmClient = require("../src/services/llmClient");

describe("LLM client timeout", () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.OPENROUTER_API_KEY;
  const originalGeminiKey = process.env.GEMINI_API_KEY;
  const originalTimeout = process.env.CONVERSATION_MEMORY_LLM_TIMEOUT_MS;
  const originalMaxRetries = process.env.CONVERSATION_MEMORY_LLM_MAX_RETRIES;
  const originalRetryBase = process.env.CONVERSATION_MEMORY_LLM_RETRY_BASE_DELAY_MS;
  const originalRetryMax = process.env.CONVERSATION_MEMORY_LLM_RETRY_MAX_DELAY_MS;

  afterEach(() => {
    global.fetch = originalFetch;

    if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalApiKey;

    if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGeminiKey;

    if (originalTimeout === undefined) delete process.env.CONVERSATION_MEMORY_LLM_TIMEOUT_MS;
    else process.env.CONVERSATION_MEMORY_LLM_TIMEOUT_MS = originalTimeout;

    if (originalMaxRetries === undefined) delete process.env.CONVERSATION_MEMORY_LLM_MAX_RETRIES;
    else process.env.CONVERSATION_MEMORY_LLM_MAX_RETRIES = originalMaxRetries;

    if (originalRetryBase === undefined) delete process.env.CONVERSATION_MEMORY_LLM_RETRY_BASE_DELAY_MS;
    else process.env.CONVERSATION_MEMORY_LLM_RETRY_BASE_DELAY_MS = originalRetryBase;

    if (originalRetryMax === undefined) delete process.env.CONVERSATION_MEMORY_LLM_RETRY_MAX_DELAY_MS;
    else process.env.CONVERSATION_MEMORY_LLM_RETRY_MAX_DELAY_MS = originalRetryMax;

    sinon.restore();
  });

  it("usa 30 segundos por defecto y permite configurarlo", () => {
    delete process.env.CONVERSATION_MEMORY_LLM_TIMEOUT_MS;
    expect(llmClient.resolveLlmTimeoutMs()).to.equal(30000);

    process.env.CONVERSATION_MEMORY_LLM_TIMEOUT_MS = "1234";
    expect(llmClient.resolveLlmTimeoutMs()).to.equal(1234);
  });

  it("rechaza una configuración de timeout inválida", () => {
    process.env.CONVERSATION_MEMORY_LLM_TIMEOUT_MS = "0";
    expect(() => llmClient.resolveLlmTimeoutMs()).to.throw("CONVERSATION_MEMORY_LLM_TIMEOUT_MS inválido");

    process.env.CONVERSATION_MEMORY_LLM_TIMEOUT_MS = "abc";
    expect(() => llmClient.resolveLlmTimeoutMs()).to.throw("CONVERSATION_MEMORY_LLM_TIMEOUT_MS inválido");
  });

  it("aborta una petición de OpenRouter que no responde", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    process.env.CONVERSATION_MEMORY_LLM_TIMEOUT_MS = "25";
    process.env.CONVERSATION_MEMORY_LLM_MAX_RETRIES = "0";

    let aborted = false;
    global.fetch = sinon.stub().callsFake((url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        aborted = true;
        const error = new Error("The operation was aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    }));

    let thrown;
    try {
      await llmClient.generateWithOpenRouter("prompt de prueba");
    } catch (error) {
      thrown = error;
    }

    expect(global.fetch.calledOnce).to.equal(true);
    expect(thrown).to.be.an("error");
    expect(thrown.code).to.equal("LLM_TIMEOUT");
    expect(thrown.message).to.include("OpenRouter request timed out after 25ms");
    expect(aborted).to.equal(true);
  });

  it("envía el timeout configurado al SDK de Gemini", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.CONVERSATION_MEMORY_LLM_TIMEOUT_MS = "4321";

    const generateContent = sinon.stub().resolves({
      response: { text: () => "respuesta" },
    });
    sinon.stub(GoogleGenerativeAI.prototype, "getGenerativeModel").returns({ generateContent });

    const result = await llmClient.generateWithGemini("prompt de prueba");

    expect(result).to.equal("respuesta");
    expect(generateContent.calledOnce).to.equal(true);
    expect(generateContent.firstCall.args).to.deep.equal([
      "prompt de prueba",
      { timeout: 4321 },
    ]);
  });
});


describe("LLM client retries", () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.OPENROUTER_API_KEY;
  const originalMaxRetries = process.env.CONVERSATION_MEMORY_LLM_MAX_RETRIES;
  const originalRetryBase = process.env.CONVERSATION_MEMORY_LLM_RETRY_BASE_DELAY_MS;
  const originalRetryMax = process.env.CONVERSATION_MEMORY_LLM_RETRY_MAX_DELAY_MS;

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalApiKey;

    if (originalMaxRetries === undefined) delete process.env.CONVERSATION_MEMORY_LLM_MAX_RETRIES;
    else process.env.CONVERSATION_MEMORY_LLM_MAX_RETRIES = originalMaxRetries;

    if (originalRetryBase === undefined) delete process.env.CONVERSATION_MEMORY_LLM_RETRY_BASE_DELAY_MS;
    else process.env.CONVERSATION_MEMORY_LLM_RETRY_BASE_DELAY_MS = originalRetryBase;

    if (originalRetryMax === undefined) delete process.env.CONVERSATION_MEMORY_LLM_RETRY_MAX_DELAY_MS;
    else process.env.CONVERSATION_MEMORY_LLM_RETRY_MAX_DELAY_MS = originalRetryMax;

    sinon.restore();
  });

  it("reintenta un 429 y devuelve la respuesta cuando el siguiente intento funciona", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    process.env.CONVERSATION_MEMORY_LLM_MAX_RETRIES = "2";
    process.env.CONVERSATION_MEMORY_LLM_RETRY_BASE_DELAY_MS = "0";
    process.env.CONVERSATION_MEMORY_LLM_RETRY_MAX_DELAY_MS = "0";

    let calls = 0;
    global.fetch = sinon.stub().callsFake(async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 429,
          text: async () => "rate limited",
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "respuesta" } }],
        }),
      };
    });

    const result = await llmClient.generateWithOpenRouter("prompt");

    expect(result).to.equal("respuesta");
    expect(calls).to.equal(2);
  });

  it("reintenta los 5xx hasta agotar el máximo configurado", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    process.env.CONVERSATION_MEMORY_LLM_MAX_RETRIES = "2";
    process.env.CONVERSATION_MEMORY_LLM_RETRY_BASE_DELAY_MS = "0";
    process.env.CONVERSATION_MEMORY_LLM_RETRY_MAX_DELAY_MS = "0";

    global.fetch = sinon.stub().resolves({
      ok: false,
      status: 503,
      text: async () => "temporarily unavailable",
    });

    let thrown;
    try {
      await llmClient.generateWithOpenRouter("prompt");
    } catch (error) {
      thrown = error;
    }

    expect(global.fetch.callCount).to.equal(3);
    expect(thrown).to.be.an("error");
    expect(thrown.status).to.equal(503);
  });

  it("no reintenta errores permanentes como 401", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    process.env.CONVERSATION_MEMORY_LLM_MAX_RETRIES = "2";
    process.env.CONVERSATION_MEMORY_LLM_RETRY_BASE_DELAY_MS = "0";
    process.env.CONVERSATION_MEMORY_LLM_RETRY_MAX_DELAY_MS = "0";

    global.fetch = sinon.stub().resolves({
      ok: false,
      status: 401,
      text: async () => "invalid api key",
    });

    let thrown;
    try {
      await llmClient.generateWithOpenRouter("prompt");
    } catch (error) {
      thrown = error;
    }

    expect(global.fetch.calledOnce).to.equal(true);
    expect(thrown).to.be.an("error");
    expect(thrown.status).to.equal(401);
  });

  it("valida la configuración de retries", () => {
    process.env.CONVERSATION_MEMORY_LLM_MAX_RETRIES = "-1";
    expect(() => llmClient.resolveLlmRetries()).to.throw("CONVERSATION_MEMORY_LLM_MAX_RETRIES inválido");

    process.env.CONVERSATION_MEMORY_LLM_MAX_RETRIES = "abc";
    expect(() => llmClient.resolveLlmRetries()).to.throw("CONVERSATION_MEMORY_LLM_MAX_RETRIES inválido");

    delete process.env.CONVERSATION_MEMORY_LLM_MAX_RETRIES;
    process.env.CONVERSATION_MEMORY_LLM_RETRY_BASE_DELAY_MS = "-1";
    expect(() => llmClient.resolveRetryBaseDelayMs()).to.throw("CONVERSATION_MEMORY_LLM_RETRY_BASE_DELAY_MS inválido");
  });

  it("reintenta un timeout y aborta definitivamente al agotar los retries", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    process.env.CONVERSATION_MEMORY_LLM_TIMEOUT_MS = "10";
    process.env.CONVERSATION_MEMORY_LLM_MAX_RETRIES = "1";
    process.env.CONVERSATION_MEMORY_LLM_RETRY_BASE_DELAY_MS = "0";
    process.env.CONVERSATION_MEMORY_LLM_RETRY_MAX_DELAY_MS = "0";

    global.fetch = sinon.stub().callsFake((url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("The operation was aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    }));

    let thrown;
    try {
      await llmClient.generateWithOpenRouter("prompt");
    } catch (error) {
      thrown = error;
    }

    expect(global.fetch.callCount).to.equal(2);
    expect(thrown).to.be.an("error");
    expect(thrown.code).to.equal("LLM_TIMEOUT");
  });
});