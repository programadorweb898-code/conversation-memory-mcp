# Conversation Memory MCP

Servidor MCP para almacenar y recuperar el historial de conversaciones de forma persistente mediante SQLite.

Este servidor sigue el estándar **Model Context Protocol (MCP)**, lo que lo hace **100% compatible con cualquier modelo o cliente que soporte MCP** (ej. Claude Desktop, otros agentes MCP, etc.), no solo con gemini-cli.

## Configuración Obligatoria para Agentes

Para garantizar la integridad y separación de datos entre diferentes proyectos, es obligatorio configurar tu agente siguiendo estas reglas:

1. **Uso Obligatorio de MCP para Consultas Históricas:** Debes configurar tu agente para que, ante cualquier pregunta sobre conversaciones pasadas, **utilice exclusivamente las herramientas expuestas por `conversation-memory-mcp`**. Prohibido leer archivos del sistema o usar memoria interna del agente para reconstruir el historial.
2. **Separación por Proyecto:** Cada agente debe pasar explícitamente el parámetro `project` (nombre del proyecto) en todas las llamadas a las herramientas del MCP. Esto garantiza que los datos y respuestas de este proyecto nunca se mezclen con otros.

Ejemplo de configuración:
> "Cuando el usuario pregunte por información histórica de este proyecto, usa obligatoriamente las herramientas `getLastSessionContext`, `searchMessages` o `semanticSearchMessages` del MCP `conversation-memory`. Asegúrate de incluir siempre el parámetro `project: 'nombre-del-proyecto'` para evitar contaminación de datos."

## Herramientas Disponibles

- `saveMessage`: Guarda un nuevo mensaje en el historial.
- `searchMessages`: Busca mensajes históricos por palabras clave.
- `lastSession`: Recupera el ID de la última sesión activa.
- `recoverSession`: Recupera el historial completo de una sesión específica.

## Desarrollo

- Base de datos: SQLite (`conversations.db`)
- Stack: Node.js, [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk), Zod
