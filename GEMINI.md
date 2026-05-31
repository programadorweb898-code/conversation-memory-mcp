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
│   │   └── recoverSession.js
│   └── services/
├── tests/
├── conversations.db
└── package.json

Development Rules
Responde siempre en español

No instales librerias ni ejecutes test automaticamente,solo dame los comandos para ejecutarlos manualmente

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

Future Roadmap

The design must allow later addition of:

- embeddings
- semantic search
- ChromaDB or Qdrant
- automatic session summaries
- integration with Engram
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