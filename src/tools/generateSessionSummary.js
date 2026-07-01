const { GoogleGenerativeAI } = require("@google/generative-ai");

// Inicializar Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Genera un resumen incremental de una sesión utilizando LLM.
 */
async function generateSessionSummary({ sessionId, previousSummary, newMessages }) {
  if (!newMessages || newMessages.length === 0) return previousSummary;

  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

  const transcript = newMessages
    .map((row) => `[${new Date(row.timestamp).toLocaleTimeString()}] ${row.role.toUpperCase()}: ${row.content}`)
    .join("\n");

  // Attempt to parse previousSummary to JSON, or use a default structure if invalid
  let previousJson;
  try {
    previousJson = typeof previousSummary === 'string' ? JSON.parse(previousSummary) : previousSummary;
  } catch (e) {
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
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    // Clean potential markdown formatting
    const jsonString = text.replace(/```json\n?|\n?```/g, '').trim();
    // Validate parsing
    JSON.parse(jsonString);
    return jsonString;
  } catch (err) {
    console.error("Error generating incremental summary with LLM:", err.message);
    // Fallback: si falla el LLM, mantenemos el resumen previo
    return JSON.stringify(previousJson);
  }
}

module.exports = generateSessionSummary;
