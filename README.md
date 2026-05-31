# Conversation Memory MCP

Servidor MCP para almacenar y recuperar el historial de conversaciones de forma persistente mediante SQLite.

Este servidor sigue el estándar **Model Context Protocol (MCP)**, lo que lo hace **100% compatible con cualquier modelo o cliente que soporte MCP** (ej. Claude Desktop, otros agentes MCP, etc.), no solo con gemini-cli.

## Configuración del Cliente

Para utilizar este servidor MCP con cualquier cliente compatible, añade la siguiente configuración en su archivo de configuración:

```json
{
  "mcpServers": {
    "conversation-memory": {
      "command": "node",
      "args": [
        "/RUTA/ABSOLUTA/A/conversation-memory-mcp/src/server.js"
      ]
    }
  }
}
```

*Reemplaza `/RUTA/ABSOLUTA/A/` con la ruta real del proyecto en tu máquina.*

## Herramientas Disponibles

- `saveMessage`: Guarda un nuevo mensaje en el historial.
- `searchMessages`: Busca mensajes históricos por palabras clave.
- `lastSession`: Recupera el ID de la última sesión activa.
- `recoverSession`: Recupera el historial completo de una sesión específica.

## Desarrollo

- Base de datos: SQLite (`conversations.db`)
- Stack: Node.js, [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk), Zod
