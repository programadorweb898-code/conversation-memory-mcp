# AGENTS.md

## Memoria conversacional

Cuando uses `conversation-memory-mcp`, mantené el aislamiento por proyecto y utilizá siempre el parámetro `project` en las llamadas al MCP.

Los turnos sustanciosos deben persistirse mediante `saveMessage` siguiendo las reglas documentadas en el README.

### No usar `agentId` en lecturas base (regla anti falsos vacíos)

`agentId` es **metadata de trazabilidad** que se guarda en cada turno, NO un filtro obligatorio de lectura.

- Al leer historial o sesiones, nunca pases `agentId` salvo que el usuario lo pida explícitamente ("la última charla con copilot", "con opencode", etc.).
- La lectura base se hace con `project` y/o `sessionId` (o la última sesión del proyecto).
- Pasar `agentId` sin que se pida puede devolver vacío aunque existan mensajes/sesiones reales de otros agentes (falsos vacíos).
- Si el usuario pide filtrar por agente, aplicá el filtro sobre los turnos ya guardados (project + agentId).

## Recuperación de conversaciones anteriores

Cuando el usuario pregunte por una sesión o período anterior:

- Para preguntas generales como "¿qué hicimos ayer?", buscá primero sesiones y resúmenes relevantes con `searchSessionsBySummary` cuando existan.
- Si existe un resumen adecuado, utilizalo como contexto principal. No vuelvas a resumir todos los turnos de esa sesión solo para responder la pregunta.
- Para preguntas específicas que requieren precisión, utilizá `searchMessages` o `semanticSearchMessages` para recuperar los mensajes originales relevantes, aunque exista un resumen.
- Si no existe un resumen adecuado, recuperá los mensajes originales necesarios y generá la respuesta en el momento.
- `conversation-memory-mcp` proporciona el contexto persistente; la respuesta final la genera el agente.
- No crees un nuevo resumen persistente únicamente por responder una pregunta histórica. Los resúmenes persistentes se generan mediante `finalizeSession`.
