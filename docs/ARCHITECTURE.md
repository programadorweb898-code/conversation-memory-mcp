# Arquitectura

## Responsabilidad

conversation-memory-mcp mantiene memoria conversacional persistente. Su fuente de verdad es PostgreSQL; el MCP expone operaciones para guardar, buscar y recuperar conversaciones.

El proyecto no implementa memoria técnica ni depende de un sistema externo de memoria. Un agente puede usar ambos sistemas de manera independiente.

## Componentes

Agente / IDE
  │
  ├── stdio ──────────────────────┐
  │                               │
  └── Streamable HTTP (/mcp) ────► MCP server
                                  │
                                  ├── tools
                                  │    ├── historial
                                  │    ├── sesiones
                                  │    ├── resúmenes
                                  │    └── administración
                                  │
                                  ├── PostgreSQL + pgvector
                                  │
                                  └── embedding worker

## Persistencia

- conversations: mensajes originales.
- session_summaries: resumen incremental por session_id + owner.
- message_embeddings: vector asociado a un mensaje.
- session_summary_embeddings: vector asociado a un resumen.
- embedding_failures: estado de reintentos del worker.
- api_keys: hashes de las claves de acceso HTTP.
- embedding_metadata: contrato activo del modelo/proveedor de embeddings.

## Identidad y aislamiento

El aislamiento lógico usa owner + project + session_id.

En HTTP, owner proviene exclusivamente de la API key autenticada. El cliente no puede elegir otro owner.

project es obligatorio en las operaciones de proyecto y representa la identidad lógica del repositorio/proyecto, no una ruta del sistema de archivos.

Una sesión para un mismo owner pertenece a un único project. PostgreSQL refuerza esta invariancia además de la validación de Node.js.

## Guardado de mensajes

1. El agente envía saveMessage.
2. Se valida project, role, content y demás campos.
3. Se resuelve el owner.
4. Se toma un advisory lock por sesión/owner.
5. Se inserta el mensaje con un sequence_id global monotónico.
6. Si embeddings están habilitados, el mensaje se encola para procesamiento asíncrono.

El embedding no forma parte de la transacción de guardado del mensaje: guardar conversación debe seguir funcionando aunque el modelo esté temporalmente indisponible.

## Resúmenes

finalizeSession obtiene solo mensajes posteriores al watermark last_processed_seq_id, genera un resumen y lo guarda junto con su embedding dentro de una transacción.

Esto permite que una sesión larga se procese incrementalmente en lugar de volver a resumir todo el historial.

## Búsqueda

### Búsqueda semántica

Usa Xenova/multilingual-e5-small con vectores de 384 dimensiones y pgvector. El modelo usa los prefijos E5 query: para consultas y passage: para contenido almacenado.

### Fallback léxico

Cuando embeddings están deshabilitados, faltan embeddings o una operación semántica falla, el sistema puede utilizar búsqueda textual con ILIKE.

Los índices pg_trgm están destinados a acelerar esas búsquedas de substring.

## Transporte

### stdio

Pensado para instalaciones locales con npx conversation-memory-mcp install.

### Streamable HTTP

El endpoint recomendado para despliegues remotos es /mcp. El manejo es stateless por request, por lo que distintas instancias pueden atender requests consecutivos.

### HTTP+SSE legacy

Los endpoints /sse y /messages mantienen estado de sesión en memoria del proceso. En varias instancias necesitan session affinity / sticky sessions.

## Seguridad

- En HTTP se exige MCP_BEARER_TOKEN para administración.
- Las API keys de usuario se almacenan únicamente como hash SHA-256.
- El owner del token determina el tenant.
- Hay rate limits y límites de concurrencia por tenant.
- project y las invariantes de sesión se validan también a nivel PostgreSQL.
- related_message_id solo puede cruzar mensajes de la misma sesión y owner.

## Invariantes de base

La migración de invariantes protege, entre otras, estas condiciones:

- IDs y valores obligatorios no pueden ser vacíos.
- Los roles válidos son user, assistant y system.
- El watermark de resumen no puede ser negativo.
- Un resumen debe utilizar el mismo proyecto que la sesión.
- Una sesión no puede mezclar proyectos para el mismo owner.
- Un related_message_id no puede apuntar a otra sesión u owner.

La base de datos es la última barrera de integridad cuando una escritura no pasa por la aplicación.

## Embeddings y reindexado

El modelo activo está registrado en embedding_metadata. Si cambia proveedor, modelo, dimensión, dtype o versión, el runtime detecta la incompatibilidad.

El reindexado se ejecuta explícitamente:

    npm run reindex:embeddings

Durante una migración de modelo se recomienda usar el fallback léxico hasta completar y verificar el reindexado.
