# Conversation Memory MCP

Servidor MCP para almacenar y recuperar **historial de conversaciones** de forma persistente mediante PostgreSQL, Neon y pgvector.

El proyecto es agnóstico del agente y tiene una responsabilidad deliberadamente acotada:

> **Guardar y recuperar lo que ocurrió en las conversaciones.**

No contiene integración, adapter, CLI, fallback ni conocimiento específico de sistemas externos de memoria técnica.

## Qué resuelve

Permite que un agente recupere conversaciones anteriores aunque ya no estén dentro de su contexto activo:

- mensajes de usuario y asistente;
- sesiones;
- resúmenes incrementales;
- búsquedas léxicas y semánticas;
- contexto por proyecto;
- trazabilidad por agente;
- aislamiento por owner en modo HTTP multi-tenant.

La separación conceptual es simple:

```text
Agente
  │
  ▼
conversation-memory-mcp
  │
  ├── historial de mensajes
  ├── sesiones
  ├── resúmenes
  └── búsqueda semántica
       │
       ▼
   Neon + pgvector
```

Si el agente utiliza además otro sistema de memoria técnica, ambos se configuran como servicios independientes. Este proyecto no necesita conocerlo ni comunicarse con él.

## Inicio rápido

Requisitos:

- Node.js 20+
- Git
- una base PostgreSQL con pgvector; Neon es una opción compatible.

Crear configuración:

```bash
cp .env.example .env
```

Definir al menos:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DB?sslmode=require
MCP_DEFAULT_OWNER=local-user
```

Instalar y ejecutar:

```bash
npm install
node src/stdio.js
```

Las migraciones se ejecutan al iniciar.

## Configuración MCP

Ejemplo para un cliente que soporte stdio:

```json
{
  "mcpServers": {
    "conversation-memory": {
      "type": "stdio",
      "command": "node",
      "args": ["<ruta-al-repositorio>/src/stdio.js"]
    }
  }
}
```

El agente debe utilizar siempre `project` para mantener separado el historial de distintos proyectos.

## Despliegue remoto (modo HTTP multi-tenant)

Además del modo local (`npx` / stdio), el servidor puede desplegarse como HTTP
para que varios usuarios/dispositivos compartan una misma instancia (por
ejemplo en Render).

**Diferencia clave con el modo local:** acá el aislamiento entre usuarios NO
depende de bases de datos separadas — todos comparten el mismo `DATABASE_URL`,
y el aislamiento lo da el token de cada usuario (`owner`), nunca un dato que
mande el cliente.

### Variables de entorno requeridas

- `DATABASE_URL`: la base compartida por todos los usuarios del servidor.
- `MCP_BEARER_TOKEN`: token maestro de administración. El proceso no arranca
  sin esta variable.
- `PORT` (opcional): puerto HTTP. Render la inyecta automáticamente.

### Pasos

1. Desplegar el servicio con `node src/server.js` como comando de inicio
   (en Render: Web Service, Node, start command `node src/server.js`).
2. Definir `DATABASE_URL` y `MCP_BEARER_TOKEN` en las variables de entorno del
   servicio.
3. Generar una API key por usuario/dispositivo:

```bash
   node scripts/create-api-key.js new --name "maxi-portatil" --owner maxi --project mi-proyecto
```

   El token se imprime una sola vez — guardarlo, ya que solo se persiste su
   hash.
4. Cada usuario configura su cliente MCP apuntando a la URL del servidor
   desplegado, enviando ese token como Bearer.
5. Administración de keys existentes:

```bash
   node scripts/create-api-key.js list
   node scripts/create-api-key.js revoke <id>
```

El token maestro (`MCP_BEARER_TOKEN`) tiene acceso total sin restricción de
owner — pensado para administración, no para uso normal de un agente.

## Herramientas principales

### Historial

- `saveMessage`: guarda un mensaje.
- `searchMessages`: búsqueda textual/híbrida.
- `semanticSearchMessages`: búsqueda semántica mediante embeddings.
- `searchSessionsBySummary`: localiza sesiones mediante sus resúmenes.
- `lastSession`: obtiene la última sesión.
- `recoverSession`: recupera una sesión completa.
- `getLastSessionContext`: recupera la última sesión con su resumen.
- `listSessions`: lista las sesiones del proyecto.

### Resúmenes

- `saveSessionSummary`
- `getSessionSummary`
- `finalizeSession`

`finalizeSession` genera un resumen incremental utilizando solo los mensajes posteriores a `last_processed_seq_id`.

Si el LLM no está disponible, el historial sigue siendo utilizable y el resumen queda pendiente. El almacenamiento y la recuperación normales no dependen de un LLM.

### Administración

- `deleteSession`
- `deleteMessage`
- `deleteMessagePair`

## Búsqueda semántica

Los mensajes pueden recibir embeddings mediante el worker interno. PostgreSQL + pgvector permite recuperar mensajes semánticamente relacionados.

Si los embeddings no están disponibles, las herramientas de búsqueda disponen de mecanismos de recuperación textual cuando corresponde.

## LLM

El LLM se utiliza únicamente para las funcionalidades que realmente necesitan generación de texto, principalmente los resúmenes de sesión.

Variables disponibles:

- `OPENROUTER_API_KEY`
- `GEMINI_API_KEY`
- `AI_PROVIDER`
- `AI_MODEL`

La ausencia de un LLM no impide guardar ni recuperar el historial.

## Guardado de conversaciones

El servidor persiste información recibida mediante `saveMessage`.

Cuando el agente no dispone de un plugin/hook de captura automática, el patrón recomendado es:

1. guardar el mensaje del usuario;
2. conservar el `messageId`;
3. guardar la respuesta del asistente con `relatedMessageId`;
4. mantener el mismo `sessionId`;
5. enviar siempre `project`;
6. utilizar `agentId` para trazabilidad;
7. evitar mensajes sin valor histórico, como saludos o confirmaciones triviales.

Si un plugin ya realiza esta captura, no deben duplicarse las llamadas manuales.

## Resúmenes frente a mensajes originales

Para preguntas generales sobre una sesión:

```text
Pregunta histórica
      │
      ▼
searchSessionsBySummary
      │
      ├── resumen disponible → utilizarlo
      │
      └── no disponible → recuperar mensajes
```

Para preguntas que requieren precisión, el agente puede consultar directamente `searchMessages`, `semanticSearchMessages` o `recoverSession`.

El MCP proporciona el contexto persistente; la respuesta final la genera el agente.

## Aislamiento

El parámetro `project` es obligatorio en las operaciones que trabajan con datos de proyecto.

En modo HTTP, el `owner` se obtiene del token autenticado y nunca se acepta como dato controlable por el cliente.

En modo local/stdio, `MCP_DEFAULT_OWNER` identifica el propietario local por defecto.

## Desarrollo

Scripts principales:

```bash
npm test
npm run lint
npm run check
npm run migrate
```

El proyecto utiliza:

- Node.js
- Express
- Model Context Protocol SDK
- Zod
- PostgreSQL
- Neon
- pgvector
- Transformers.js para embeddings

## Principio de diseño

```text
conversation-memory-mcp
        │
        ▼
"¿Qué dijimos?"
"¿Qué hicimos?"
"¿Qué mensaje tuvimos?"
"¿Qué ocurrió en esa sesión?"
        │
        ▼
Historial conversacional persistente
```

La memoria técnica, las decisiones durables y otros sistemas externos de memoria quedan fuera del alcance de este proyecto y deben ser responsabilidad de herramientas o MCP independientes.
