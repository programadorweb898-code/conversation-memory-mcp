// src/services/llmClient.js
//
// Cliente único de LLM para las funciones que necesitan un modelo de texto:
// resúmenes de sesión (generateSessionSummary). Evita acoplar cada tool a un
// proveedor.
//
// Proveedores soportados (se resuelven en cada llamada):
//   - "openrouter": API compatible con OpenAI. Modelo por defecto:
//     nvidia/nemotron-3-super-120b-a12b:free (Nemotron 120B, variante gratuita
//     sujeta al límite y disponibilidad establecidos por OpenRouter).
//   - "gemini": SDK @google/generative-ai. Modelo por defecto:
//     gemini-2.5-flash-lite.
//
// Selección de proveedor:
//   - AI_PROVIDER=openrouter|gemini fuerza uno.
//   - Sin AI_PROVIDER, se autodetecta: si hay OPENROUTER_API_KEY usamos
//     OpenRouter; si no, si hay GEMINI_API_KEY usamos Gemini; si no hay
//     ninguna, generateText devuelve null.

const { GoogleGenerativeAI } = require("@google/generative-ai");

const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash-lite";
const OPENROUTER_DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_LLM_TIMEOUT_MS = 30000;
const DEFAULT_LLM_MAX_RETRIES = 2;
const DEFAULT_LLM_RETRY_BASE_DELAY_MS = 250;
const DEFAULT_LLM_RETRY_MAX_DELAY_MS = 2000;

function resolveLlmTimeoutMs() {
  const raw = process.env.CONVERSATION_MEMORY_LLM_TIMEOUT_MS;
  if (raw === undefined || raw === "") return DEFAULT_LLM_TIMEOUT_MS;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`CONVERSATION_MEMORY_LLM_TIMEOUT_MS inválido: "${raw}"`);
  }
  return parsed;
}

function createLlmTimeoutError(provider, timeoutMs, cause) {
  const error = new Error(`${provider} request timed out after ${timeoutMs}ms`);
  error.code = "LLM_TIMEOUT";
  error.cause = cause;
  return error;
}

function resolveLlmRetries() {
  const raw = process.env.CONVERSATION_MEMORY_LLM_MAX_RETRIES;
  if (raw === undefined || raw === "") return DEFAULT_LLM_MAX_RETRIES;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`CONVERSATION_MEMORY_LLM_MAX_RETRIES inválido: "${raw}"`);
  }
  return parsed;
}

function resolveRetryBaseDelayMs() {
  const raw = process.env.CONVERSATION_MEMORY_LLM_RETRY_BASE_DELAY_MS;
  if (raw === undefined || raw === "") return DEFAULT_LLM_RETRY_BASE_DELAY_MS;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`CONVERSATION_MEMORY_LLM_RETRY_BASE_DELAY_MS inválido: "${raw}"`);
  }
  return parsed;
}

function resolveRetryMaxDelayMs() {
  const raw = process.env.CONVERSATION_MEMORY_LLM_RETRY_MAX_DELAY_MS;
  if (raw === undefined || raw === "") return DEFAULT_LLM_RETRY_MAX_DELAY_MS;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`CONVERSATION_MEMORY_LLM_RETRY_MAX_DELAY_MS inválido: "${raw}"`);
  }
  return parsed;
}

function getErrorStatus(error) {
  return Number(error?.status ?? error?.statusCode ?? error?.cause?.status ?? 0);
}

function isRetryableLlmError(error) {
  if (!error) return false;
  if (error.code === "LLM_TIMEOUT") return true;

  const status = getErrorStatus(error);
  return status === 429 || (status >= 500 && status <= 599);
}

function retryDelayMs(attempt) {
  const base = resolveRetryBaseDelayMs();
  const max = resolveRetryMaxDelayMs();
  return Math.min(max, base * (2 ** Math.max(0, attempt - 1)));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withLlmRetries(operation) {
  const maxRetries = resolveLlmRetries();

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryableLlmError(error) || attempt >= maxRetries) {
        throw error;
      }

      await sleep(retryDelayMs(attempt + 1));
    }
  }
}

function detectProvider() {
  const explicit = (process.env.AI_PROVIDER || "").trim().toLowerCase();
  if (explicit === "openrouter") return "openrouter";
  if (explicit === "gemini" || explicit === "google") return "gemini";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return null;
}

function resolveModel(provider) {
  const override = (process.env.AI_MODEL || "").trim();
  if (override) return override;
  return provider === "gemini" ? GEMINI_DEFAULT_MODEL : OPENROUTER_DEFAULT_MODEL;
}

async function generateWithGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const timeoutMs = resolveLlmTimeoutMs();
  const genAI = new GoogleGenerativeAI(apiKey);
  const generativeModel = genAI.getGenerativeModel({ model: resolveModel("gemini") });

  return withLlmRetries(async () => {
    try {
      const result = await generativeModel.generateContent(prompt, { timeout: timeoutMs });
      return result.response.text();
    } catch (error) {
      if (error?.name === "GoogleGenerativeAIAbortError") {
        throw createLlmTimeoutError("Gemini", timeoutMs, error);
      }
      throw error;
    }
  });
}

async function generateWithOpenRouter(prompt) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const timeoutMs = resolveLlmTimeoutMs();

  return withLlmRetries(async () => {
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: resolveModel("openrouter"),
          messages: [{ role: "user", content: prompt }],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        const error = new Error(`OpenRouter ${res.status}: ${detail.slice(0, 300)}`);
        error.status = res.status;
        throw error;
      }
      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? null;
    } catch (error) {
      if (error?.name === "TimeoutError" || error?.name === "AbortError") {
        throw createLlmTimeoutError("OpenRouter", timeoutMs, error);
      }
      throw error;
    }
  });
}

/**
 * Devuelve el texto plano generado por el LLM para un prompt, o null si no hay
 * proveedor configurado. Las API keys se leen en el momento de la llamada.
 * @param {string} prompt - Prompt completo para el modelo.
 * @returns {Promise<string|null>}
 */
async function generateText(prompt) {
  const provider = detectProvider();
  if (!provider) return null;
  if (provider === "gemini") return generateWithGemini(prompt);
  return generateWithOpenRouter(prompt);
}

module.exports = {
  generateText,
  detectProvider,
  resolveModel,
  resolveLlmTimeoutMs,
  resolveLlmRetries,
  resolveRetryBaseDelayMs,
  resolveRetryMaxDelayMs,
  isRetryableLlmError,
  retryDelayMs,
  generateWithGemini,
  generateWithOpenRouter,
  OPENROUTER_DEFAULT_MODEL,
  GEMINI_DEFAULT_MODEL,
  DEFAULT_LLM_TIMEOUT_MS,
  DEFAULT_LLM_MAX_RETRIES,
  DEFAULT_LLM_RETRY_BASE_DELAY_MS,
  DEFAULT_LLM_RETRY_MAX_DELAY_MS,
};