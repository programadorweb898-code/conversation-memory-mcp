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
- SQLite
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
├── conversations.db
└── package.json

Development Rules
Responde siempre en español

No instales librerias ni ejecutes test automaticamente,solo dame los comandos para ejecutarlos manualmente

### Política de Persistencia Proactiva (Obligatorio)

Como agente, debo asegurar la persistencia automática de toda la historia de trabajo:

1.  **Persistencia en MCP (Registro Crudo):** Tras cada interacción (prompt y respuesta), debo ejecutar obligatoriamente `saveMessage` para persistir el contenido automáticamente.
2.  **Persistencia en Engram (Conocimiento Semántico):** Cuando detecte una decisión técnica, un bug fix, o una regla de proyecto, debo ejecutar automáticamente `mem_save` en Engram sin esperar a que el usuario lo solicite.
3.  **Uso Activo del Servidor MCP Local:** Asumo que el servidor MCP `conversation-memory-mcp` (definido en `.gemini/settings.json`) está en ejecución o debe ser iniciado cuando sea necesario para las operaciones de memoria conversacional. Debo utilizar activamente las herramientas de este servidor para gestionar el historial de conversaciones y el contexto.
4.  **Recuperación Automática al Inicio:** Al iniciar cualquier sesión con el servidor `conversation-memory-mcp`, debo invocar automáticamente la herramienta `getLastSessionContext` para recuperar el resumen y contexto de la última sesión y tener la memoria activa de inmediato.


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
- keep SQLite access centralized
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

Workflow

When asked to continue development:

1. Inspect current files.
2. Determine next missing step.
3. Implement only that step.
4. Explain what was done.
5. Provide commands to test it.

Never rewrite completed files unless necessary.

Always prioritize small, verifiable iterations.