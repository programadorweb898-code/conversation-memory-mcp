const MEMORY_POLICY = [
  "## Prioridad de memoria conversacional",
  "",
  "Cuando una pregunta requiera información sobre trabajo anterior, sesiones anteriores, historial del proyecto, qué se habló, qué se hizo, qué se probó o qué ocurrió en una conversación, consulta primero `conversation-memory-mcp`.",
  "",
  "No utilices el historial de la sesión actual o del IDE como fuente de verdad para recuperar información histórica cuando `conversation-memory-mcp` esté disponible.",
  "",
  "Usa siempre el parámetro `project` al consultar `conversation-memory-mcp`.",
  "",
  "## Guardado por turno",
  "",
  "Persistí cada turno sustancioso en `conversation-memory-mcp` mediante `saveMessage`, al cerrar el turno:",
  "",
  "1. guardá primero el mensaje del usuario (role: \"user\") y conservá el `messageId` que devuelve;",
  "2. guardá la respuesta del asistente (role: \"assistant\") pasando ese `messageId` como `relatedMessageId`;",
  "3. mantené el mismo `sessionId` durante toda la sesión;",
  "4. incluí siempre `project` y usá `agentId` para trazabilidad;",
  "5. no guardes mensajes sin valor histórico (saludos o confirmaciones triviales).",
  "",
  "No llames a `saveMessage` manualmente si tu entorno ya cuenta con un plugin/hook de captura automática (por ejemplo, OpenCode): duplicarías los turnos.",
].join("\n");

const POLICY_MARKER = "<!-- conversation-memory-mcp:memory-priority-policy -->";
const POLICY_END_MARKER = "<!-- /conversation-memory-mcp:memory-priority-policy -->";

module.exports = { MEMORY_POLICY, POLICY_MARKER, POLICY_END_MARKER };
