const recoverSession = require("./recoverSession");

const MEMORY_TYPES = ["decision", "discovery", "constraint", "configuration", "lesson"];

/**
 * Recupera una sesión completa y la prepara como contexto para identificar
 * candidatos de memoria semántica durable. NO guarda nada: solo extrae y estructura.
 * @param {Object} params - Parámetros de extracción.
 * @param {string} params.sessionId - El ID de la sesión a recuperar.
 * @param {string} params.project - El proyecto al que pertenece la sesión.
 * @param {string} [params.agentId] - ID del agente para filtrar los mensajes.
 * @returns {Promise<Object>} - Sesión recuperada con instrucciones de análisis.
 */
async function extractMemories({ sessionId, project, agentId }) {
  if (!project) throw new Error("El parámetro 'project' es obligatorio.");

  const messages = await recoverSession({ sessionId, project, agentId });

  return {
    project,
    sessionId,
    messageCount: messages.length,
    messages,
    instructions: {
      purpose: "Identificar información que pueda convertirse en memoria semántica durable",
      memoryTypes: MEMORY_TYPES,
    },
  };
}

module.exports = extractMemories;
module.exports.extractMemories = extractMemories;
module.exports.MEMORY_TYPES = MEMORY_TYPES;