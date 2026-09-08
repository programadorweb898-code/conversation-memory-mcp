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

## Guardado automático — Cliente opencode (caso particular)

En opencode el guardado de cada turno es **automático y obligatorio**: el plugin global `conversation-memory` (`~/.config/opencode/plugins/conversation-memory.ts`) persiste en este MCP el par usuario/assistant de cada turno en cuanto la sesión queda idle. No depende de que el agente "se acuerde".

- El plugin se conecta al servidor con el SDK MCP y llama `saveMessage` por cada mensaje nuevo.
- El `project` se resuelve solo (nombre del directorio de trabajo en minúsculas, con aliases configurables).
- Lleva una caché local (`~/.config/opencode/conversation-memory-cache.json`) para no duplicar guardados entre reinicios.
- En este cliente, los agentes **no deben** llamar `saveMessage` manualmente salvo backfill puntual: duplicaría mensajes.
- Configuración: `CONVERSATION_MEMORY_URL` y `CONVERSATION_MEMORY_TOKEN` como variables de entorno, o se leen solas de `mcp.conversation-memory` del `opencode.json(c)` global o del proyecto.

Este comportamiento es específico de opencode. En otros clientes sin plugin equivalente, el propio agente es quien guarda los turnos mediante `saveMessage`.

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
