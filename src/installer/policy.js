const MEMORY_POLICY = [
  "## Prioridad de memoria conversacional",
  "",
  "Cuando una pregunta requiera información sobre trabajo anterior, sesiones anteriores, historial del proyecto, qué se habló, qué se hizo, qué se probó o qué ocurrió en una conversación, consulta primero `conversation-memory-mcp`.",
  "",
  "No utilices el historial de la sesión actual o del IDE como fuente de verdad para recuperar información histórica cuando `conversation-memory-mcp` esté disponible.",
  "",
  "Usa siempre el parámetro `project` al consultar `conversation-memory-mcp`.",
].join("\n");

const POLICY_MARKER = "<!-- conversation-memory-mcp:memory-priority-policy -->";
const POLICY_END_MARKER = "<!-- /conversation-memory-mcp:memory-priority-policy -->";

module.exports = { MEMORY_POLICY, POLICY_MARKER, POLICY_END_MARKER };
