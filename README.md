# Conversation Memory MCP

Servidor MCP para almacenar y recuperar el historial de conversaciones de forma persistente mediante SQLite.

Este servidor sigue el estándar **Model Context Protocol (MCP)**, lo que lo hace **100% compatible con cualquier modelo o cliente que soporte MCP** (ej. Claude Desktop, otros agentes MCP, etc.), no solo con gemini-cli.

## Configuración Obligatoria para Agentes

Para garantizar la integridad y separación de datos entre diferentes proyectos, es obligatorio configurar tu agente siguiendo estas reglas:

1. **Uso Obligatorio de MCP para Consultas Históricas:** Debes configurar tu agente para que, ante cualquier pregunta sobre conversaciones pasadas, **utilice exclusivamente las herramientas expuestas por `conversation-memory-mcp`**. Prohibido leer archivos del sistema o usar memoria interna del agente para reconstruir el historial.
2. **Parámetro `project` Obligatorio:** Todas las herramientas del MCP exigen el parámetro `project`. El servidor lo **rechaza si falta** y solo guarda/lee/elimina datos del proyecto indicado. Además, si un `sessionId` ya pertenece a otro proyecto, la operación falla (código `PROJECT_CONFLICT`) para impedir cualquier mezcla de datos.

Ejemplo de configuración:
> "Cuando el usuario pregunte por información histórica de este proyecto, usa obligatoriamente las herramientas del MCP `conversation-memory`. Asegúrate de incluir **siempre** el parámetro `project: 'nombre-del-proyecto'` en **todas** las llamadas, ya que el servidor lo exige para aislar los datos por proyecto."

## Herramientas Disponibles

- `saveMessage`: Guarda un nuevo mensaje en el historial. `project` obligatorio.
- `searchMessages`: Busca mensajes históricos por palabras clave. `project` obligatorio.
- `lastSession`: Recupera el ID de la última sesión activa del proyecto. `project` obligatorio.
- `recoverSession`: Recupera el historial completo de una sesión específica del proyecto. `project` obligatorio.

Todas las herramientas (incluyendo resúmenes, eliminaciones y búsquedas semánticas) requieren `project` para garantizar el aislamiento de datos entre proyectos.

## Desarrollo

- Base de datos: SQLite (`conversations.db`)
- Stack: Node.js, [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk), Zod
