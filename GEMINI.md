Conversation Memory MCP Project

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

Technical Requirements

Stack:

- Node.js
- PostgreSQL (Render)
- MCP SDK
- UUID
- Zod
- Optional future vector search support

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

Development Rules
Responde siempre en español.

No instales librerias ni ejecutes test automaticamente, solo dame los comandos para ejecutarlos manualmente.

### Regla de Orientación al Inicio (Obligatorio)
Al iniciar cualquier sesión, lo PRIMERO que debo hacer es:
1. Leer las 'Capacidades del Proyecto' para saber qué hace el sistema.
2. Consultar Engram (`mem_context`) para saber en qué punto nos quedamos.
3. Esto garantiza que no declararé como 'faltante' algo que ya está construido.

## Capacidades del Proyecto
El sistema ya cuenta con las siguientes funcionalidades terminadas:
- **Persistencia de Historial Crudo:** Almacenamiento completo de mensajes (user/assistant) y sesiones en PostgreSQL (Render).
- **Gestión de Sesiones:** Recuperación de sesiones completas y obtención del contexto de la última sesión (`getLastSessionContext`).
- **Búsqueda:** Funcionalidad de búsqueda por palabras clave y capacidad de búsqueda semántica.
- **Integración con Engram:** Capacidad de enviar mensajes críticos a Engram (`pushToEngram`) para memoria semántica de largo plazo.
- **Persistencia Proactiva:** Mecanismos automáticos de guardado de mensajes (raw) y decisiones/aprendizajes (semantic/Engram).
- **Protocolo de Fallo:** Fallback automático a Engram para recuperar contexto estratégico si la base de datos remota es inaccesible.


El usuario no debe tener que recordar guardar el historial o el conocimiento; es responsabilidad exclusiva del agente.

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

Integration Workflow with Engram

To bridge raw conversation history with Engram's semantic memory:
1. Use `getLastSessionContext` to get the full raw history.
2. Use `pushToEngram` on specific `messageId`s that contain critical decisions, findings, or learned patterns.
3. Call Engram's `mem_save` with the content retrieved from `pushToEngram` to store it semantically.

Database Requirements

Store:

- id
- session_id
- timestamp
- project
- role
- content

Support:

- save message
- search by keyword
- recover session
- retrieve last session
- push to Engram
- get last session context
- delete message
- delete session
Future Roadmap

The design must allow later addition of:

- embeddings
- semantic search
- ChromaDB or Qdrant
- automatic session summaries
- multi-agent memory sharing

### Regla de Verificación de Estado (Obligatorio)
Antes de declarar que una funcionalidad falta o debe ser implementada, el agente DEBE consultar Engram (`mem_context`, `mem_search`) y los resúmenes de sesión previos. La memoria de Engram es la única fuente de verdad sobre el estado real de la implementación. Nunca asumas que algo falta solo porque no aparece en una inspección de archivos superficial.