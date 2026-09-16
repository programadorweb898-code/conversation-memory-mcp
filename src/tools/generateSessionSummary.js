const llmClient = require("../services/llmClient");

/**
 * Genera un resumen incremental de una sesión utilizando LLM.
 * Si no hay proveedor configurado o el LLM falla, devuelve null para que
 * finalizeSession no marque los mensajes como resumidos.
 */
async function generateSessionSummary({ sessionId, previousSummary, newMessages }) {
  if (!newMessages || newMessages.length === 0) return previousSummary;

  const transcript = newMessages
    .map((row) => `[${new Date(row.timestamp).toLocaleTimeString()}] ${row.role.toUpperCase()}: ${row.content}`)
    .join("\n");

  let previousJson;
  try {
    previousJson = typeof previousSummary === "string" ? JSON.parse(previousSummary) : previousSummary;
  } catch {
    previousJson = { goal: "", discoveries: [], accomplished: [], next_steps: [] };
  }

  const prompt = `
    Eres un experto en síntesis de conversaciones.
    Toma el resumen anterior (en formato JSON) y los nuevos mensajes, y genera un ÚNICO resumen actualizado (en formato JSON) integrando todo.

    ESTRUCTURA REQUERIDA (JSON):
    {
      "goal": "string",
      "discoveries": ["string", ...],
      "accomplished": ["string", ...],
      "next_steps": ["string", ...]
    }

    Reglas de fusión:
    1. 'goal': Mantén el original, actualiza solo si el contexto indica un nuevo objetivo.
    2. 'discoveries' y 'accomplished': Combina los del resumen previo con los nuevos mensajes, elimina duplicados.
    3. 'next_steps': Reemplaza completamente con los nuevos pasos derivados de la conversación.
    4. NO incluyas introducciones, solo el objeto JSON puro.

    Resumen previo:
    ${JSON.stringify(previousJson, null, 2)}

    Nuevos mensajes:
    ${transcript}
  `;

  try {
    const text = await llmClient.generateText(prompt);
    if (!text) return null;

    const jsonString = text.replace(/```json\n?|\n?```/g, '').trim();
    JSON.parse(jsonString);
    return jsonString;
  } catch (err) {
    console.error("Error generating incremental summary with LLM:", err.message);
    return null;
  }
}

module.exports = generateSessionSummary;
