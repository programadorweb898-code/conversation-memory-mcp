const { expect } = require("chai");
const sinon = require("sinon");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const llmClient = require("../src/services/llmClient");

describe("LLM client timeout", () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.OPENROUTER_API_KEY;
  const originalGeminiKey = process.env.GEMINI_API_KEY;
  const originalTimeout = process.env.CONVERSATION_MEMORY_LLM_TIMEOUT_MS;

  afterEach(() => {
    global.fetch = originalFetch;

    if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalApiKey;

    if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGeminiKey;

    if (originalTimeout === undefined) delete process.env.CONVERSATION_MEMORY_LLM_TIMEOUT_MS;
    else process.env.CONVERSATION_MEMORY_LLM_TIMEOUT_MS = originalTimeout;

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
