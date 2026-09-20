# Conversation Memory MCP Project

Estás ayudando a desarrollar un MCP llamado `conversation-memory-mcp`.

## Objetivo

El proyecto tiene una responsabilidad única:

> Mantener y recuperar el historial persistente de conversaciones.

Debe almacenar y recuperar:

- mensajes de usuario;
- respuestas del asistente;
- sesiones;
- timestamps;
- proyecto;
- agente;
- resúmenes;
- embeddings para búsqueda semántica.

El proyecto es agnóstico del agente y **no depende de ningún sistema externo de memoria técnica**.

## Arquitectura

```text
Agente
  │
  ▼
conversation-memory-mcp
  │
  ├── PostgreSQL / Neon
  ├── pgvector
  ├── historial
  └── resúmenes
```

Si un agente utiliza otro MCP para memoria técnica, ese MCP debe configurarse y utilizarse por separado. `conversation-memory-mcp` no debe importarlo, invocarlo, detectarlo ni utilizarlo como fallback.

## Reglas de comportamiento

Responde siempre en español.

No instales librerías, no ejecutes archivos ni ejecutes tests automáticamente. Cuando corresponda, proporciona los comandos para que el usuario los ejecute manualmente.

### Consultas históricas

1. Para preguntas generales, consultar primero resúmenes existentes mediante `searchSessionsBySummary`.
2. Para preguntas específicas, utilizar `searchMessages`, `semanticSearchMessages` o `recoverSession`.
3. Si no existe resumen, recuperar los mensajes originales necesarios.
4. No inventar información histórica que no esté en el historial recuperado.

### Guardado

Cuando no exista automatización externa:

1. guardar cada turno sustancioso con `saveMessage`;
2. conservar el `messageId`;
3. relacionar la respuesta mediante `relatedMessageId`;
4. mantener el mismo `sessionId`;
5. incluir siempre `project`;
6. utilizar `agentId` para trazabilidad.

Si ya existe un plugin/hook que guarda los turnos, no duplicar las llamadas.

## Capacidades

- Persistencia del historial conversacional.
- Recuperación de sesiones.
- Búsqueda textual.
- Búsqueda semántica.
- Resúmenes incrementales.
- Aislamiento por proyecto.
- Aislamiento por owner en HTTP.
- Trazabilidad por agente.

## LLM

El LLM se utiliza para generar resúmenes cuando está configurado.

La ausencia del LLM no debe impedir:

- guardar mensajes;
- recuperar mensajes;
- buscar historial;
- administrar sesiones.

## Desarrollo

Trabajar incrementalmente.

Para cada cambio:

1. explicar el objetivo;
2. modificar solo lo necesario;
3. agregar o actualizar pruebas;
4. proporcionar los pasos de verificación.

Mantener:

- arquitectura simple;
- archivos pequeños;
- lógica reutilizable;
- acceso a base de datos centralizado;
- validación de entradas;
- aislamiento por proyecto y owner;
- ausencia de dependencias innecesarias.

## Regla de independencia

No agregar al proyecto:

- adapters para otros sistemas de memoria;
- llamadas a CLIs externas de memoria;
- fallbacks hacia otros sistemas de memoria;
- variables de entorno específicas de otros sistemas de memoria;
- herramientas MCP cuyo propósito sea exportar o promover memoria hacia otro sistema;
- tablas o columnas cuyo único propósito sea almacenar referencias a otra memoria técnica.

La responsabilidad del proyecto termina en el historial conversacional persistente y sus mecanismos propios de recuperación.
