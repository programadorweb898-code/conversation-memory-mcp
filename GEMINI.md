# Conversation Memory MCP Project

You are helping build a production-ready MCP server called "conversation-memory-mcp".

Goal:
Create a persistent conversation memory system that complements Engram.

Engram stores semantic knowledge and important facts.

This MCP stores complete conversation history:

- user messages
- assistant responses
- sessions
- timestamps
- project context

The system must allow future agents to answer questions such as:

- "What did we discuss last week about JWT?"
- "What was your exact answer when I asked about UserCard?"
- "Recover the previous session."
- "Find conversations related to Stripe."

## Technical Requirements

Stack:

- Node.js
- PostgreSQL (Neon)
- MCP SDK
- UUID
- Zod
- Optional vector search support

Architecture:

conversation-memory-mcp/
├── src/
│   ├── database.js
│   ├── server.js
│   ├── tools/
│   │   ├── saveMessage.js
│   │   ├── searchMessages.js
│   │   ├── lastSession.js
│   │   ├── recoverSession.js
│   │   ├── pushToEngram.js
│   │   ├── getLastSessionContext.js
│   │   ├── deleteMessage.js
│   │   └── deleteSession.js
│   └── services/
├── tests/
└── package.json

## Development Rules

Responde siempre en español.

No instales librerías, no ejecutes archivos ni ejecutes tests automáticamente, solo dame los comandos para ejecutarlos manualmente.

### Regla de Orientación al Inicio (Obligatorio)

Al iniciar cualquier sesión o ante cualquier consulta sobre eventos pasados, seguiré este protocolo:

1. **Uso del MCP:** Para consultar el pasado, utilizaré las herramientas de `conversation-memory-mcp`.
2. **Preguntas generales:** Para consultas como "¿qué hicimos ayer?", buscaré primero sesiones y resúmenes relevantes con `searchSessionsBySummary`. Si existe un resumen adecuado, lo utilizaré como contexto principal y no volveré a resumir todos los turnos.
3. **Preguntas específicas:** Si la consulta requiere precisión sobre un hecho concreto, utilizaré `searchMessages` o `semanticSearchMessages` para recuperar los mensajes originales relevantes, aunque exista un resumen.
4. **Sin resumen:** Si no existe un resumen adecuado, recuperaré los mensajes originales necesarios y generaré la respuesta en el momento.
5. **Fallback estratégico:** Si el historial persistente es inaccesible o no contiene la información necesaria y Engram está disponible, consultaré Engram (`mem_context`, `mem_search`) como fuente secundaria.

`conversation-memory-mcp` proporciona el contexto persistente; la respuesta final la genera el agente. No crearé un nuevo resumen persistente únicamente por responder una pregunta histórica.

### Reglas de Interacción y Búsqueda

- Seguir el escalonamiento Resumen → Historial → Engram cuando corresponda.
- Si el usuario consulta sobre algo del pasado y, tras realizar la búsqueda escalonada, la información no se encuentra, responder explícitamente: "Eso no lo hablamos", seguido de la respuesta basada en conocimiento general o razonamiento actual.
- El usuario no debe tener que recordar guardar el historial o el conocimiento; es responsabilidad del agente.

## Guardado de conversación

El servidor solo persiste información recibida mediante `saveMessage`.

Cuando no exista un plugin o hook que capture automáticamente los turnos:

1. Guardar cada turno sustancioso del usuario con `saveMessage`.
2. Conservar el `messageId` devuelto.
3. Guardar la respuesta del asistente utilizando `relatedMessageId`.
4. Mantener el mismo `sessionId` durante la sesión.
5. Incluir siempre `project`.
6. Identificar el agente mediante `agentId`.
7. Omitir saludos, confirmaciones cortas y mensajes sin valor de recuperación.

Si existe un plugin/hook que ya automatiza el guardado, no duplicar las llamadas manualmente.

## Auditoría automática de Engram al finalizar una sesión

Al finalizar una sesión, después de llamar a `finalizeSession`, comprobar si Engram está disponible en el proyecto.

- Si Engram no está instalado, configurado o disponible, no ejecutar la auditoría de Engram.
- Si Engram está disponible y `finalizeSession` devuelve `auditRequired: true`, llamar a `memoryAudit` para la sesión actual.
- Si `finalizeSession` devuelve `auditRequired: false` porque el resumen no pudo generarse por falta de LLM, no ejecutar la auditoría automática en ese momento.
- No llamar primero a `extractMemories`: `memoryAudit` ya realiza esa extracción internamente.

`memoryAudit` audita la sesión contra las memorias durables existentes y **no modifica Engram por sí mismo**. Después de la auditoría, `memoryPromote` es la ruta controlada para promover candidatos con estado `missing` hacia Engram a través de `MemoryAdapter`.

Flujo de decisión:

- `missing`: si el conocimiento es durable e importante, llamar a `memoryPromote` con el candidato. No llamar directamente a `mem_save` para el mismo candidato.
- `already_exists`: no guardar nada para evitar duplicados.
- `related`: no promover automáticamente; si el conocimiento nuevo realmente debe persistir, utilizar las capacidades de Engram disponibles de forma consciente.
- `possible_duplicate`: no crear otra memoria automáticamente; resolverlo con las capacidades de Engram cuando corresponda.
- `conflict`: utilizar `mem_judge` para resolver el conflicto antes de modificar una memoria.
- Si una decisión, configuración o conocimiento durable existente cambió de forma relevante, utilizar la tool de actualización de Engram disponible, por ejemplo `mem_update`.
- No promover a Engram información trivial, temporal o descartada.

`memoryPromote` es idempotente y controla la promoción mediante el adapter. `pushToEngram` no es una segunda vía de promoción: solamente prepara el contenido de un mensaje para una inspección o backfill manual y no escribe en Engram. Para el flujo automático/auditado, utilizar siempre `memoryAudit` → `memoryPromote`.

Engram debe seguir funcionando normalmente durante la sesión. Esta auditoría es una capa adicional al finalizar y tiene tres objetivos: detectar conocimiento importante que faltó guardar, evitar duplicados y mantener actualizadas las decisiones relevantes del proyecto.

No inventar operaciones de Engram: utilizar únicamente las tools que el agente tenga realmente disponibles.

## Capacidades del Proyecto

El sistema cuenta con:

- **Persistencia de Historial Crudo:** almacenamiento de mensajes y sesiones en PostgreSQL (Neon).
- **Gestión de Sesiones:** recuperación de sesiones completas y contexto de la última sesión.
- **Resúmenes incrementales:** `finalizeSession` resume solo los mensajes posteriores al último `last_processed_seq_id`.
- **Recuperación eficiente:** para preguntas generales sobre sesiones anteriores se priorizan resúmenes existentes; para preguntas específicas se recuperan mensajes originales relevantes.
- **Búsqueda:** búsqueda por palabras clave y búsqueda semántica.
- **Memoria durable opcional:** integración con Engram mediante un adapter y herramientas de auditoría/promoción.
- **Persistencia Proactiva:** mecanismos para guardar historial de conversación.
- **Aislamiento por proyecto:** las llamadas al MCP deben incluir siempre `project`.
- **LLM configurable:** OpenRouter usa Nemotron 120B gratuito como modelo predeterminado; el usuario puede cambiar `AI_MODEL` o `AI_PROVIDER`.

## Reglas de desarrollo

Work incrementally.

Never generate the entire project at once.

For every feature:

1. Explain the objective.
2. Create the file.
3. Explain why the code is needed.
4. Add tests or verification steps.
5. Wait for confirmation before moving forward.

Always:

- use clean architecture principles
- keep files small
- avoid duplicated logic
- use dependency injection when appropriate
- keep database access centralized
- prefer maintainability over clever code

## Regla de Verificación de Estado (Obligatorio)

Antes de declarar que una funcionalidad falta o debe ser implementada, el agente DEBE consultar Engram (`mem_context`, `mem_search`) y los resúmenes de sesión previos cuando estén disponibles. Nunca asumas que algo falta solo porque no aparece en una inspección de archivos superficial.
