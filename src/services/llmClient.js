// src/services/llmClient.js
//
// Cliente único de LLM para las funciones que necesitan un modelo de texto:
// resúmenes de sesión (generateSessionSummary) y el pipeline de memoria
// (extractMemories / memoryAudit). Evita acoplar cada tool a un proveedor.
//
// Proveedores soportados (se resuelven en cada llamada):
//   - "openrouter": API compatible con OpenAI. Modelo por defecto:
//     nvidia/nemotron-3-super-120b-a12b (Nemotron 120B, versión paga; cuesta
//     ~$0.08/M input y ~$0.45/M output). La variante ":free" existe pero tiene
//     tope de ~50 req/día; se elige con AI_MODEL si se prefiere.
//   - "gemini": SDK @google/generative-ai. Modelo por defecto:
//     gemini-2.5-flash-lite.
//
// Selección de proveedor:
//   - AI_PROVIDER=openrouter|gemini fuerza uno.
//   - Sin AI_PROVIDER, se autodetecta: si hay OPENROUTER_API_KEY usamos
//     OpenRouter; si no, si hay GEMINI_API_KEY usamos Gemini; si no hay
//     ninguna, generateText devuelve null (y cada tool cae a su fallback).

const { GoogleGenerativeAI } = require("@google/generative-ai");

const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash-lite";
// Versión paga de Nemotron 120B: sin tope diario de requsts. La variante ":free"
// (agregar ":free" al slug) es gratuita pero limitada a ~50 req/día por cuenta.
const OPENROUTER_DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

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
  const genAI = new GoogleGenerativeAI(apiKey);
  const generativeModel = genAI.getGenerativeModel({ model: resolveModel("gemini") });
  const result = await generativeModel.generateContent(prompt);
  return result.response.text();
}

async function generateWithOpenRouter(prompt) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
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
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? null;
}

/**
 * Devuelve el texto plano generado por el LLM para un prompt, o null si no hay
 * proveedor configurado (las tools usan su fallback local en ese caso).
 * Las API keys se leen en el momento de la llamada (no al cargar el módulo).
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
  generateWithGemini,
  generateWithOpenRouter,
  OPENROUTER_DEFAULT_MODEL,
  GEMINI_DEFAULT_MODEL,
};