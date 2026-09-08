# Conversation Memory MCP

Servidor MCP para almacenar y recuperar el historial de conversaciones de forma persistente mediante **PostgreSQL (Neon + pgvector)**.

Este servidor sigue el estándar **Model Context Protocol (MCP)**, lo que lo hace **100% compatible con cualquier modelo o cliente que soporte MCP** (Claude Desktop, otros agentes MCP, etc.), no solo con opencode.

Es un servidor agnóstico de agente: no depende de ningún cliente concreto. Cualquier agente que consuma MCP puede guardar y consultar historial usando sus herramientas.

## Uso para cualquier agente

Este MCP expone herramientas para persistir y recuperar conversaciones por proyecto. Para usarlo desde cualquier agente o cliente MCP:

1. **Guardar turnos** con `saveMessage`: el agente guiado por la descripción de la tool guarda cada par usuario/assistant que tenga contenido sustancioso (usuario primero anotando su `messageId`, luego la respuesta con `relatedMessageId`).
2. **Parámetro `project` obligatorio** en todas las herramientas: aísla los datos por proyecto.
3. **`agentId`** (opcional) identifica al agente que genera el mensaje, para poder filtrar por agente más adelante.

## Configuración Obligatoria para Agentes

Para garantizar la integridad y separación de datos entre diferentes proyectos, es obligatorio configurar tu agente siguiendo estas reglas:

1. **Uso Obligatorio de MCP para Consultas Históricas:** Debes configurar tu agente para que, ante cualquier pregunta sobre conversaciones pasadas, **utilice exclusivamente las herramientas expuestas por `conversation-memory-mcp`**. Prohibido leer archivos del sistema o usar memoria interna del agente para reconstruir el historial.
2. **Parámetro `project` Obligatorio:** Todas las herramientas del MCP exigen el parámetro `project`. El servidor lo **rechaza si falta** y solo guarda/lee/elimina datos del proyecto indicado. Además, si un `sessionId` ya pertenece a otro proyecto, la operación falla (código `PROJECT_CONFLICT`) para impedir cualquier mezcla de datos.

Ejemplo de configuración:
> "Cuando el usuario pregunte por información histórica de este proyecto, usa obligatoriamente las herramientas del MCP `conversation-memory`. Asegúrate de incluir **siempre** el parámetro `project: 'nombre-del-proyecto'` en **todas** las llamadas, ya que el servidor lo exige para aislar los datos por proyecto."

## Guardado automático en cualquier agente — Instrucción al agente

El servidor **no guarda turnos por sí solo**: solo persiste lo que recibe vía `saveMessage`. En clientes sin plugin (Copilot, Claude Desktop, Cursor, agentes remotos, etc.) el guardado de cada turno depende de que el agente esté **configurado con una instrucción** que lo obligue a llamar `saveMessage`. El servidor es agnóstico: no detecta turnos, no cachea, no inyecta parámetros.

Para que un agente arbitrario guarde cada turno, configuralo con esta instrucción (ajustá `agentId` según el agente):

> "Guardá en este MCP de memoria cada turno de conversación que tenga contenido sustancioso, usando la herramienta `saveMessage` del servidor `conversation-memory-mcp`:
> 1. Llamá `saveMessage` con el mensaje del usuario (`role: 'user'`) y anotá el `messageId` que devuelve.
> 2. Llamá `saveMessage` con tu respuesta (`role: 'assistant'`) pasando ese `messageId` como `relatedMessageId`.
> 3. Usá el mismo `sessionId` durante toda la sesión activa.
> 4. Incluí siempre el parámetro `project` (el nombre del directorio de trabajo, en minúsculas).
> 5. Identificate con tu `agentId` propio (por ejemplo `'copilot'`, `'claude-desktop'`, `'gemini-cli'`).
> 6. Omití saludos, confirmaciones cortas (\"ok\", \"entendido\") y mensajes sin valor de recuperación."

Dónde ponerla según el cliente:
- **VS Code / GitHub Copilot**: archivo `*.instructions.md` en el perfil de usuario (`%APPDATA%\Code\User\instructions\`) con frontmatter `applyTo: '**'`, o en `.github/instructions/` del repositorio.
- **Cualquier agente MCP**: en la configuración de instrucciones del agente (prompt de sistema, reglas del proyecto `AGENTS.md`, etc.).

Este es el patrón «por instrucción al agente» (el mismo que usa Engram): el agente guarda guiado por la instrucción, sin depender del servidor ni de características específicas del cliente. Los clientes con plugins o hooks pueden automatizar este guardado por su cuenta.

## Herramientas Disponibles

- `saveMessage`: Guarda un nuevo mensaje en el historial. `project` obligatorio.
- `searchMessages`: Busca mensajes por palabras clave o semánticamente. `project` obligatorio.
- `semanticSearchMessages`: Busca mensajes semánticamente similares (pgvector). `project` obligatorio.
- `searchSessionsBySummary`: Busca sesiones por su resumen semántico y recupera su historial. `project` obligatorio.
- `lastSession`: Recupera el ID de la última sesión activa del proyecto. `project` obligatorio.
- `recoverSession`: Recupera el historial completo de una sesión específica del proyecto. `project` obligatorio.
- `getLastSessionContext`: Recupera el historial completo de la última sesión. `project` obligatorio.
- `listSessions`: Lista las sesiones disponibles. `project` obligatorio.
- `extractMemories`: Recupera una sesión y prepara candidatos de memoria semántica durable. `project` obligatorio.
- `memoryAudit` / `memoryPromote`: Auditán y promueven candidatos hacia un proveedor de memoria dura. `project` obligatorio.
- Resúmenes (`saveSessionSummary`, `getSessionSummary`, `finalizeSession`) y eliminaciones (`deleteSession`, `deleteMessage`, `deleteMessagePair`): `project` obligatorio.
- `generateAndSaveEmbedding`: Genera y guarda un embedding para un mensaje.

Todas las herramientas requieren `project` para garantizar el aislamiento de datos entre proyectos.

## Desarrollo

- Base de datos: **PostgreSQL en Neon con extensión pgvector** (búsquedas semánticas por distancia de coseno).
- Stack: Node.js, [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk), Express, Zod.
