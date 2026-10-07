# Operaciones y troubleshooting

## Instalación local

La ruta pública recomendada es:

    npx conversation-memory-mcp install

También puede indicarse el agente:

    npx conversation-memory-mcp install --agent opencode

El instalador configura base de datos, MCP y política del agente. Es idempotente y conserva las demás entradas de configuración.

### Verificar la instalación

Reiniciá el agente y comprobá que el MCP figure conectado. En stdio, verificá que el proceso pueda iniciar:

    npx conversation-memory-mcp

El arranque de stdio no ejecuta migraciones automáticamente.

## Base de datos y migraciones

La variable principal es:

    CONVERSATION_MEMORY_DATABASE_URL=postgresql://...

La base debe estar dedicada a Conversation Memory.

Para migrar manualmente una base existente:

    npx conversation-memory-mcp migrate

El comando muestra host, base y schema y requiere confirmación explícita antes de ejecutar las migraciones.

Nunca uses la base de otra aplicación como destino de estas migraciones.

## Embeddings

Para desactivar embeddings y conservar recuperación mediante fallback léxico:

    ENABLE_EMBEDDINGS=false

Para reindexar:

    npm run reindex:embeddings

Ejemplos:

    npm run reindex:embeddings -- --owner maxi
    npm run reindex:embeddings -- --scope messages
    npm run reindex:embeddings -- --scope summaries --batch-size 25
    npm run reindex:embeddings -- --dry-run

Ante un cambio de modelo:

1. desactivá temporalmente la búsqueda semántica;
2. ejecutá el reindexado con el proveedor/modelo nuevo;
3. verificá el resultado;
4. volvé a habilitar embeddings.

El proceso es idempotente y usa UPSERT; no necesita borrar masivamente todos los vectores antes de empezar.

## Servidor HTTP

Variables mínimas:

    CONVERSATION_MEMORY_DATABASE_URL=postgresql://...
    MCP_BEARER_TOKEN=...
    PORT=3000

Después de desplegar, generá una API key por usuario/dispositivo:

    node scripts/create-api-key.js new --name notebook --owner luis --project mi-proyecto

Administración:

    node scripts/create-api-key.js list
    node scripts/create-api-key.js revoke <id>

El token generado se muestra una sola vez porque la base solo conserva su hash.

## Diagnóstico rápido

### El MCP no inicia

Comprobá:

- Node.js 20 o superior.
- CONVERSATION_MEMORY_DATABASE_URL.
- conectividad con PostgreSQL/Neon.
- que el archivo de configuración del agente apunte al MCP correcto.

### La búsqueda semántica devuelve vacío

Primero verificá:

- ENABLE_EMBEDDINGS no está en false;
- existen embeddings para el proyecto;
- el modelo activo coincide con embedding_metadata;
- no hubo un cambio de modelo sin reindexado.

Como comprobación operativa, probá temporalmente el fallback léxico con embeddings deshabilitados.

### Aparece SESSION_UNAVAILABLE

Normalmente indica que la misma combinación owner + session_id está asociada a otro project. No reutilices un session_id entre proyectos.

### SSE funciona en una instancia pero falla en varias

El transporte legacy /sse mantiene las sesiones en memoria de proceso. Usá sticky sessions o migrá a Streamable HTTP /mcp para una topología multi-instancia.

### Una migración falla antes de modificar datos

La migración de invariantes ejecuta un preflight. Esto significa que encontró registros existentes que no cumplen el contrato nuevo. Corregí esos datos de forma controlada y volvé a ejecutar la migración; no desactives las restricciones.

## Mantenimiento

Antes de operaciones históricas o destructivas:

- hacé backup;
- revisá el host, base y schema;
- probá primero sobre una copia.

Los scripts legacy de migrations/manual/ no forman parte del flujo automático de instalación.
