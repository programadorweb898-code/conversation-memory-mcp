# Uso con npx + Neon

`conversation-memory-mcp` puede ejecutarse localmente con `npx` y conectarse directamente a PostgreSQL en Neon.

Este modo **no necesita Render ni otro servidor intermedio**.

## Arquitectura

```text
                 Neon PostgreSQL + pgvector
                         ▲
                         │
              ┌──────────┴──────────┐
              │                     │
          Usuario A             Usuario B
              │                     │
         npx MCP local         npx MCP local
              │                     │
       OpenCode / Claude      OpenCode / Gemini
```

Cada usuario utiliza su propia base/credencial de Neon. De esta forma, el aislamiento entre usuarios no depende de un `user_id` enviado por el agente ni de un filtro de aplicación.

La seguridad queda apoyada en la propia credencial de PostgreSQL: una instalación solo puede consultar la base a la que su `DATABASE_URL` le da acceso.

## Importante sobre el aislamiento

No es seguro distribuir una única `DATABASE_URL` privilegiada a todos los usuarios y pretender aislarlos solamente agregando `user_id` a las tablas.

Un cliente que posee credenciales PostgreSQL puede conectarse directamente a la base y ejecutar SQL fuera de las reglas de la aplicación.

Por eso el modo `npx` de este proyecto adopta un modelo **BYOD (Bring Your Own Database)**:

- cada usuario configura su propia conexión Neon;
- la misma conexión puede utilizarse desde varios dispositivos del mismo usuario;
- todos los agentes de ese usuario pueden compartir la misma memoria;
- usuarios diferentes utilizan bases/credenciales diferentes;
- no existe una credencial maestra compartida dentro del paquete npm.

Si en el futuro se quiere ofrecer una única base Neon multi-tenant administrada por el proyecto, será necesario añadir una capa de identidad/autenticación confiable y RLS con JWT. Neon Data API soporta este modelo mediante JWT + PostgreSQL RLS, pero es un diseño diferente al modo `npx` directo.

## Instalación

Requisitos:

- Node.js 18+
- una base PostgreSQL en Neon
- `pgvector` disponible en esa base

Ejecutar:

```bash
npx conversation-memory-mcp
```

El proceso necesita `DATABASE_URL`. `MCP_DEFAULT_OWNER` es opcional y usa `local-user` por defecto.

### Windows PowerShell

```powershell
$env:DATABASE_URL="postgresql://USER:PASSWORD@HOST/DB?sslmode=require"
$env:MCP_DEFAULT_OWNER="local-user"
npx conversation-memory-mcp
```

### Linux / macOS / Git Bash

```bash
export DATABASE_URL="postgresql://USER:PASSWORD@HOST/DB?sslmode=require"
export MCP_DEFAULT_OWNER="local-user"
npx conversation-memory-mcp
```

También puede utilizarse un archivo `.env` cuando el cliente MCP ejecute el proceso en un entorno donde ese archivo sea accesible.

## Migraciones

El modo `npx` ejecuta las migraciones antes de iniciar el servidor MCP.

Las migraciones son idempotentes y utilizan un advisory lock de PostgreSQL para evitar que dos procesos las ejecuten simultáneamente.

Por lo tanto, el usuario no necesita ejecutar manualmente `npm run migrate` para la primera instalación del MCP.

## Varios dispositivos

La memoria no se almacena en el equipo donde corre `npx`; se almacena en Neon.

Por ejemplo:

```text
PC principal ── npx MCP ──┐
                          ├──► Neon del usuario
Notebook ───── npx MCP ───┤
                          │
Otro equipo ── npx MCP ───┘
```

Todos pueden recuperar la misma memoria siempre que utilicen la misma base/credencial de Neon.

## Varios agentes

El mismo usuario puede conectar el MCP desde distintos agentes:

```text
OpenCode ──────┐
Claude ────────┤
Gemini CLI ────┼──► npx conversation-memory-mcp ──► Neon
Otro agente ───┘
```

El campo `project` continúa siendo el mecanismo lógico para separar proyectos dentro de la base del usuario, mientras que la propia base/credencial proporciona el aislamiento entre usuarios.

## Seguridad de la DATABASE_URL

`DATABASE_URL` contiene credenciales de PostgreSQL.

No debe:

- publicarse en GitHub;
- incluirse en el código del agente;
- compartirse con otros usuarios;
- incluirse en capturas de pantalla;
- guardarse en un repositorio público.

Si una credencial se filtra, debe rotarse desde Neon.
