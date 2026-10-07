# Conversation Memory MCP

Servidor MCP para almacenar y recuperar **historial de conversaciones** de forma persistente mediante PostgreSQL, Neon y pgvector.

El proyecto es agnóstico del agente y tiene una responsabilidad deliberadamente acotada:

> **Guardar y recuperar lo que ocurrió en las conversaciones.**

No contiene integración, adapter, fallback ni conocimiento específico de sistemas externos de memoria técnica.

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
- PostgreSQL con pgvector; Neon es una opción compatible.

En un proyecto existente, la instalación recomendada es:

```bash
npx conversation-memory-mcp install
```

El instalador realiza en este orden:

1. busca `CONVERSATION_MEMORY_DATABASE_URL` en el entorno o en `.env`;
2. si no existe, permite introducir una conexión dedicada exclusivamente a Conversation Memory o crear una base mediante Neon Claimable;
3. valida la conexión y muestra host, base y schema;
4. solicita confirmación explícita antes de ejecutar migraciones;
5. guarda la URL dedicada en `.env` sin cambiar `DATABASE_URL` de la aplicación anfitriona;
6. agrega `.env` a `.gitignore` si todavía no está ignorado;
7. detecta/configura el agente y agrega la política de prioridad de memoria.

La opción Neon Claimable permite empezar sin una cuenta Neon. El instalador ejecuta automáticamente el comando de Neon para crear la base temporal y el CLI de Neon muestra un enlace de reclamación durante ese paso. Guardá ese enlace y abrilo para transferir el proyecto a tu organización de Neon. El proyecto sin reclamar expira después de 72 horas. Para una base permanente, se recomienda reclamarla o utilizar una conexión PostgreSQL existente.

Si ya tenés una base **dedicada a Conversation Memory**, podés configurar:

```env
CONVERSATION_MEMORY_DATABASE_URL=postgresql://USER:PASSWORD@HOST/DB?sslmode=require
MCP_DEFAULT_OWNER=local-user
```

El instalador no adopta `DATABASE_URL` automáticamente. No apuntes esta variable a una base de otra aplicación. Las migraciones se ejecutan durante la instalación solo después de confirmar el destino; iniciar el MCP por stdio no ejecuta migraciones.

En instalación de proyecto, la URL dedicada se guarda en el `.env` de ese proyecto. En instalación global, se guarda en el archivo de configuración del usuario (`%APPDATA%/conversation-memory-mcp/.env` en Windows o `~/.config/conversation-memory-mcp/.env` en Linux/macOS), para que el MCP funcione aunque el agente arranque desde otro directorio.

## Instalación de la política del agente

Configurar el MCP no garantiza que el agente lo consulte primero cuando una pregunta requiere historial anterior. El instalador configura ambas piezas para el agente seleccionado:

1. el servidor MCP en la configuración de proyecto compatible;
2. la política de prioridad de memoria en las instrucciones del proyecto.

Ejemplo:

```bash
npx conversation-memory-mcp install --agent opencode
```

El instalador es idempotente y conserva otros servidores MCP existentes. La configuración se limita al proyecto actual; no modifica silenciosamente la configuración global del usuario.

Agentes reconocidos:

- OpenCode
- Codex
- Claude Code
- VS Code / Copilot
- GitHub Copilot CLI
- Cursor
- Kimi Code
- Kilo Code
- Kiro IDE
- Gemini CLI
- Qwen Code
- Windsurf
- Antigravity
- OpenClaw
- Trae
- Pi
- Hermes

Para los agentes cuyo formato de configuración MCP todavía no tiene un adaptador específico, el instalador instala la política y deja indicado que la configuración MCP debe realizarse manualmente.

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

### Política de prioridad de memoria

Configurar este MCP no significa que el agente vaya a consultarlo automáticamente para preguntas sobre el historial del proyecto. El agente puede tener otras fuentes de contexto, como el historial de su propia sesión, el historial del IDE o sesiones anteriores. Para evitar que esas fuentes se conviertan en la fuente de verdad, el agente debe recibir una instrucción de prioridad de memoria.

La instrucción recomendada es:

> Para preguntas sobre trabajo anterior, sesiones anteriores, historial del proyecto, qué se habló, qué se hizo, qué se probó o qué ocurrió en una conversación, consulta primero `conversation-memory-mcp`. No utilices el historial de la sesión actual o del IDE como fuente de verdad cuando este MCP esté disponible para recuperar la información solicitada.

**Importante:** esta política debe configurarse en el agente correspondiente (por ejemplo, mediante las instrucciones del repositorio, `AGENTS.md`, instrucciones personalizadas o la configuración equivalente del cliente). El MCP no debe asumir ni implementar conocimiento específico de un agente o IDE.

El paquete incluye un instalador para agregar esta política al archivo de instrucciones del proyecto. La instalación de la política forma parte de la configuración del agente, no del servidor MCP. El servidor permanece agnóstico respecto del agente o IDE que lo utilice.

## Modelo HTTP multi-instancia

El transporte recomendado para despliegues remotos con varias instancias es **Streamable HTTP en `/mcp`**. Esta implementación es stateless: cada request crea su propio `McpServer` y `StreamableHTTPServerTransport`, por lo que un balanceador puede enviar requests consecutivos a distintas instancias sin compartir estado de sesión.

El transporte legacy **HTTP+SSE en `/sse` + `/messages`** se conserva únicamente para clientes que todavía lo necesitan. Su mapa de sesiones vive en memoria del proceso. Por eso:

- una sola instancia: funciona normalmente;
- varias instancias: requiere **sticky sessions/session affinity** para que `GET /sse` y los `POST /messages` de esa sesión lleguen a la misma instancia;
- sin afinidad, la sesión puede aparecer como expirada cuando el POST cae en otra instancia.

No se debe resolver ese problema copiando el `Map` local entre procesos: para hacer un SSE multi-instancia real habría que introducir almacenamiento/ruteo externo de estado y mensajes. Para un despliegue nuevo, preferí `/mcp`.

El servidor expone el modo seleccionado mediante `X-MCP-Transport-Mode`:
- `stateless-streamable-http` en `/mcp`;
- `legacy-sse-instance-local` en `/sse`.

En el segundo caso también expone `X-MCP-Session-Affinity: required`.

## Despliegue remoto (modo HTTP multi-tenant)

Además del modo local (`npx` / stdio), el servidor puede desplegarse como HTTP
para que varios usuarios/dispositivos compartan una misma instancia (por
ejemplo en Render).

**Diferencia clave con el modo local:** acá el aislamiento entre usuarios NO
depende de bases de datos separadas — los usuarios autorizados del servidor
comparten la base dedicada configurada en `CONVERSATION_MEMORY_DATABASE_URL`,
y el aislamiento lo da el token de cada usuario (`owner`), nunca un dato que
mande el cliente.

### Variables de entorno requeridas

- `CONVERSATION_MEMORY_DATABASE_URL`: la base dedicada compartida por los usuarios autorizados del servidor.
- `MCP_BEARER_TOKEN`: token maestro de administración. El proceso no arranca
  sin esta variable.
- `PORT` (opcional): puerto HTTP. Render la inyecta automáticamente.

### Pasos

1. Desplegar el servicio con `node src/server.js` como comando de inicio
   (en Render: Web Service, Node, start command `node src/server.js`).
2. Definir `CONVERSATION_MEMORY_DATABASE_URL` y `MCP_BEARER_TOKEN` en las variables de entorno del
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

Además de limitar la tasa de requests, el modo HTTP aplica límites de concurrencia por tenant para evitar que un owner monopolice el pool de conexiones con operaciones simultáneas lentas. Por defecto cada owner puede tener hasta 10 requests MCP simultáneas en `/mcp` y `/messages`, y hasta 10 sesiones SSE activas. Varias API keys del mismo owner comparten el mismo límite. El token maestro queda fuera de estas cuotas para tareas administrativas.

Se pueden ajustar con `MCP_TENANT_MAX_CONCURRENT_REQUESTS` y `MCP_TENANT_MAX_SSE_SESSIONS`.

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

El resumen generado por el LLM se valida con un esquema estructural antes de guardarlo: `goal` debe ser string y `discoveries`, `accomplished` y `next_steps` deben ser arrays de strings. Los campos inesperados también se rechazan.

No existe finalización automática: el resumen se genera solo cuando el agente llama a `finalizeSession`. No hay ningún proceso que revise sesiones inactivas ni las cierre por su cuenta.

Si el LLM no está disponible, el historial sigue siendo utilizable y el resumen queda pendiente. El almacenamiento y la recuperación normales no dependen de un LLM.

### Administración

- `deleteSession`
- `deleteMessage`
- `deleteMessagePair`

## Búsqueda semántica

Los mensajes reciben embeddings con `Xenova/multilingual-e5-small`, un modelo E5 multilingüe de 384 dimensiones preparado para Transformers.js. El proveedor usa `query: ` para consultas y `passage: ` para contenido almacenado, que es la convención con la que fue entrenado el modelo. 

**Importante:** cambiar el modelo de embeddings requiere reindexar los embeddings existentes antes de confiar en la búsqueda semántica sobre datos ya almacenados.

Los mensajes pueden recibir embeddings mediante el worker interno. PostgreSQL + pgvector permite recuperar mensajes semánticamente relacionados.

### Reindexado de embeddings

El reindexado es una operación de mantenimiento explícita:

```bash
npm run reindex:embeddings
```

El comando usa el proveedor/modelo configurado actualmente y procesa por lotes tanto `conversations` como `session_summaries`. La navegación de mensajes usa `sequence_id`; la de resúmenes usa el cursor compuesto `timestamp + session_id + owner`. Esto evita cargar toda la base en memoria y permite que una ejecución interrumpida pueda repetirse sin dejar los vectores anteriores borrados.

Opciones:

```bash
npm run reindex:embeddings -- --owner maxi
npm run reindex:embeddings -- --scope messages
npm run reindex:embeddings -- --scope summaries --batch-size 25
npm run reindex:embeddings -- --dry-run
```

El proceso hace `UPSERT` del vector nuevo después de generarlo. No ejecuta un `DELETE` masivo previo, por lo que una falla a mitad de una corrida conserva los embeddings que todavía no fueron reemplazados. Los mensajes demasiado cortos para embedding se limpian de `message_embeddings` solo cuando se procesan y se confirma que siguen siendo demasiado cortos.

Durante un cambio de modelo, hasta terminar el reindexado pueden convivir vectores del modelo anterior y del nuevo. Para una migración en producción, se recomienda ejecutar el reindexado como tarea de mantenimiento mientras el servidor tiene `ENABLE_EMBEDDINGS=false`, de modo que las búsquedas usen el fallback textual durante la ventana. Si el mismo `.env` tiene esa variable en `false`, el proceso de mantenimiento debe sobrescribirla explícitamente: `ENABLE_EMBEDDINGS=true npm run reindex:embeddings`. Una vez completado y verificado el reindexado, se vuelve a habilitar la búsqueda semántica.

El reindexado es idempotente: volver a ejecutarlo recalcula los mismos registros y sobrescribe sus vectores. El próximo punto (#13) agregará metadatos de modelo/versión para poder detectar automáticamente qué vectores están desactualizados y permitir migraciones side-by-side sin mezclar versiones.

Si los embeddings no están disponibles, las herramientas de búsqueda disponen de mecanismos de recuperación textual cuando corresponde.

## LLM

El LLM se utiliza únicamente para las funcionalidades que realmente necesitan generación de texto, principalmente los resúmenes de sesión.

Variables disponibles:

- `OPENROUTER_API_KEY`
- `GEMINI_API_KEY`
- `AI_PROVIDER`
- `AI_MODEL`
- `CONVERSATION_MEMORY_LLM_TIMEOUT_MS` (opcional; por defecto 30000 ms)
- `CONVERSATION_MEMORY_LLM_MAX_RETRIES` (opcional; por defecto 2 reintentos)
- `CONVERSATION_MEMORY_LLM_RETRY_BASE_DELAY_MS` (opcional; por defecto 250 ms)
- `CONVERSATION_MEMORY_LLM_RETRY_MAX_DELAY_MS` (opcional; por defecto 2000 ms)

Las llamadas al LLM tienen un timeout explícito para no quedar esperando indefinidamente ante un proveedor externo sin respuesta. En OpenRouter el timeout aborta la petición HTTP; en Gemini se envía como timeout de la petición del SDK.

Ante fallos transitorios se realizan como máximo 2 reintentos adicionales por defecto, con backoff exponencial y límite de espera. Se consideran reintentables los `429`, los `5xx` y los timeouts. Errores permanentes como `400` o `401` fallan inmediatamente.

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

## Configuración centralizada

La configuración de runtime se interpreta en un único módulo: `src/config.js`. Ahí se concentran los defaults, la conversión de tipos y las validaciones de las variables utilizadas por el servidor, PostgreSQL, embeddings y LLM.

Los módulos de runtime consumen esa configuración en lugar de interpretar directamente `process.env`. Esto evita defaults diferentes entre componentes y hace que una configuración inválida falle de forma explícita.

> Las rutas especiales del instalador y las variables propias de cada agente (por ejemplo OpenCode/Copilot) siguen siendo responsabilidad de sus respectivos módulos.

## Desarrollo

Scripts principales:

```bash
npm test
npm run lint
npm run check
npx conversation-memory-mcp migrate
```

### Scripts de `scripts/`

El campo `files` de `package.json` publica `migrate.js`,
`create-api-key.js` y `reindex-embeddings.js`. El reindexador forma parte
del paquete porque es una operación de mantenimiento que puede necesitarse
sobre una instalación ya desplegada. Los demás scripts internos del repo no
viajan en el paquete.

El único flujo público de instalación es:

```bash
npx conversation-memory-mcp install
```

El instalador moderno configura la base de datos, el MCP y la política del
agente desde un único punto de entrada. No se publica ni se mantiene un
segundo instalador de plugin para evitar dos mecanismos con comportamientos
distintos o destinos de configuración diferentes.

`npx conversation-memory-mcp migrate` muestra host, base y schema, y exige confirmación explícita antes de aplicar migraciones. `npm run migrate` es el runner de desarrollo; sus callers programáticos deben pasar autorización.

Las operaciones históricas y destructivas se mantienen fuera del loader automático en `migrations/manual/`. No se ejecutan durante `install` ni al iniciar stdio; requieren revisión del destino y backup antes de aplicarse manualmente.

**No ejecutar (LEGACY).** `migrate_sequence.js`, `migrate_to_pgvector.js` y
`migrate_project_backfill.js` son migraciones de una sola vez, aplicadas sobre
una base que ya tenía conversaciones. Cada una arregla algo que una base
nueva no tiene: `sequence_id` porque ordenar por `timestamp` no distingue dos
turnos del mismo milisegundo; `vector(384)` porque los embeddings se guardaban
como texto y sin eso no hay búsqueda semántica; y el backfill de `project`
porque la columna nació después que las filas que ya existían.

`migrate_sequence.js` hace su backfill con un único `UPDATE` sobre toda la tabla
`conversations`, así que es la única operación del repo que podría pasarse del
tope de 60s si la tabla creciera mucho. Si eso pasara, se sube solo para esa
corrida:

```bash
CONVERSATION_MEMORY_QUERY_TIMEOUT_MS=600000 npm run migrate
```

### Tope de duración de las queries

Por default cada statement tiene 60s de tope, aplicado por el servidor con
`statement_timeout`. El server-side es el mecanismo primario a propósito:
Postgres cancela la query él mismo y la conexión sigue reutilizable. Hay
además un timeout del lado cliente, 5s por encima, que solo entra en juego si el
socket se muere y el servidor no puede cancelar nada; cuando ese caso se
dispara, la conexión se destruye en vez de volver al pool, porque para entonces
ya no es confiable. Se ajusta con `CONVERSATION_MEMORY_QUERY_TIMEOUT_MS`.

Una instalación nueva no los necesita: `migrations/001_initial_schema.sql` ya
incluye `CREATE EXTENSION vector`, `ADD COLUMN IF NOT EXISTS project`,
`sequence_id`, la secuencia y el índice HNSW, todo con `IF NOT EXISTS` e
idempotente. Para una base ya migrada, volver a correrlos no aporta nada.
Quedan como registro histórico de cómo esa base pasó de un estado a otro.

**Mantenimiento opcional.** `finalize_sessions.js` recorre los proyectos y
finaliza sesiones viejas invocando al LLM. No pide confirmación y no filtra
por antigüedad: usalo solo si querés cerrar todo, y sobre una copia primero.

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
