# Conversation Memory MCP

Servidor MCP para almacenar y recuperar el historial de conversaciones de forma persistente mediante **PostgreSQL (Neon + pgvector)**.

Este servidor sigue el estándar **Model Context Protocol (MCP)** y está diseñado para ser **agnóstico del agente**: cualquier modelo, agente o cliente compatible con MCP puede utilizarlo para guardar y recuperar conversaciones.

El objetivo es resolver un problema concreto: **que un agente pueda recuperar conversaciones anteriores sin depender de que esa información siga presente en su contexto actual**.

---

## ¿Qué problema resuelve?

Los agentes de IA tienen una limitación fundamental: el contexto de una conversación no equivale a una memoria persistente.

Cuando una sesión termina, cambia de sesión, se compacta el contexto o se utiliza otro agente, información importante puede quedar fuera del contexto activo:

* decisiones tomadas anteriormente;
* conversaciones técnicas;
* soluciones a problemas;
* explicaciones dadas al agente;
* contexto de un proyecto;
* historial de trabajo;
* decisiones relacionadas con una implementación.

`conversation-memory-mcp` mantiene ese **historial conversacional completo** fuera del contexto del modelo y permite recuperarlo cuando sea necesario mediante herramientas MCP.

La idea central es separar:

> **Contexto actual del agente ≠ historial persistente de conversaciones.**

---

# Inicio rápido (clonado + Neon personal)

**Requisitos:** Node.js 20+, git. Verificá tu versión con `node --version` antes de continuar.

Cada usuario crea su propia base de datos en **Neon** (plan gratuito) y ejecuta el MCP localmente con `node src/stdio.js`. **Los chats de cada persona nunca se mezclan porque están en bases de datos distintas.**

### 1. Crear una base en Neon

1. Andá a [neon.tech](https://neon.tech) y creá una cuenta (gratuito).
2. Creá un nuevo proyecto.
3. Copiá el **connection string** que Neon te da (empieza con `postgres://...`).

### 2. Configurar el `.env`

En la raíz del repositorio clonado, creá un archivo `.env` a partir del ejemplo:

```bash
cp .env.example .env
```

Editá `.env` y completá tu connection string:

```bash
DATABASE_URL=postgresql://neondb_owner:tu_clave@ep-tu-proyecto-region.aws.neon.tech/neondb?sslmode=require
MCP_DEFAULT_OWNER=tu-nombre-o-equipo
```

**No compartas este archivo ni lo subas a git.** Contiene las credenciales de tu base.

Además de `DATABASE_URL`, podés definir `MCP_DEFAULT_OWNER` para identificar el dueño local de los datos que escribe este proceso. Si no lo definís, se usa el valor seguro `local-user`. En una instalación personal puede ser tu usuario, tu nombre o el identificador del equipo.

También admite variables **opcionales** (explicadas en `.env.example`):

| Variable | Uso | Default |
|---|---|---|
| `MCP_DEFAULT_OWNER` | Dueño local de los datos escritos en modo stdio o admin. | `local-user` |
| `OPENROUTER_API_KEY` | Proveedor LLM usado por defecto cuando está configurado. Se utiliza para resúmenes de sesión y tareas de memoria que requieren LLM. | — |
| `AI_MODEL` | Permite elegir el modelo. Con OpenRouter, si se omite, se usa Nemotron 120B gratuito. | `nvidia/nemotron-3-super-120b-a12b:free` |
| `AI_PROVIDER` | Forzar proveedor: `openrouter` o `gemini` (sin él se autodetecta por las keys presentes). | autodetección |
| `GEMINI_API_KEY` | Proveedor alternativo de LLM (Gemini). | — |
| `ENABLE_EMBEDDING_WORKER` | Poner en `false` desactiva el worker de embeddings en modo stdio. | habilitado |

### Modelo LLM predeterminado

El proveedor OpenRouter utiliza por defecto:

```text
nvidia/nemotron-3-super-120b-a12b:free
```

Es la variante gratuita de Nemotron y está sujeta a los límites y a la disponibilidad establecidos por OpenRouter. La cuota puede cambiar según las condiciones vigentes del proveedor.

**Las restricciones pertenecen al proveedor, no a `conversation-memory-mcp`.** Si querés evitar las restricciones de un modelo gratuito o preferís otro modelo, podés cambiarlo mediante `AI_MODEL` sin modificar el código.

Ejemplo:

```bash
AI_MODEL=otro-modelo-compatible
```

También podés seleccionar otro proveedor:

```bash
AI_PROVIDER=gemini
GEMINI_API_KEY=tu_clave
AI_MODEL=gemini-2.5-flash-lite
```

El LLM se utiliza para tareas que necesitan generación o análisis, principalmente **resúmenes de sesión, extracción de memorias y auditoría**. El almacenamiento y recuperación normal del historial no depende de un LLM.

### 3. Ejecutar

```bash
git clone <url-del-repositorio>
cd conversation-memory-mcp
npm install
cp .env.example .env
```

Editá `.env` y definí al menos `DATABASE_URL`. `MCP_DEFAULT_OWNER` es opcional y usa `local-user` por defecto:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DB?sslmode=require
MCP_DEFAULT_OWNER=local-user
```

Después iniciá el servidor:

```bash
node src/stdio.js
```

El servidor inicia en modo stdio y queda listo para que tu agente lo utilice.

Las migraciones se ejecutan automáticamente al iniciar.

### 4. Configurar tu agente

Agregá el MCP a la configuración de tu agente (por ejemplo, opencode):

```jsonc
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

Y recordá instruir al agente para que incluya `project` en cada llamada al MCP (ver [Configuración obligatoria para agentes](#configuración-obligatoria-para-agentes)).

### 5. ¿Por qué es privado?

Cada usuario tiene **su propia base de datos en Neon**. No hay base compartida. Tus chats están en tu base; los de otra persona están en la suya. Nadie puede acceder a tu base sin tu `DATABASE_URL`, que es única por proyecto de Neon.

---

### 6. La cadena de conexión: qué es, cómo se carga y dónde

Esta es la parte más importante para entender y configurar. **La cadena de conexión es "la llave de tu base"**: es la única información que le dice a un agente dónde están tus chats.

```text
DATABASE_URL=postgresql://neondb_owner:tu_clave@ep-tu-proyecto-region.aws.neon.tech/neondb?sslmode=require
```

Contiene el nombre del servidor de Neon, el nombre de usuario y la contraseña. Quien tenga esta cadena puede conectarse a tu base y leerla. Guardala siempre en un lugar seguro y **nunca la publiques**.

#### Cómo se carga (paso a paso, sin ser desarrollador)

1. Andá a [neon.tech](https://neon.tech), ingresá a tu proyecto y copiá el **connection string**.
2. En la carpeta del proyecto, creá un archivo llamado `.env` (o editá el que ya existe) y pegá tu cadena así:
   ```bash
   DATABASE_URL=postgresql://neondb_owner:tu_clave@ep-tu-proyecto-region.aws.neon.tech/neondb?sslmode=require
   ```
3. Guardá el archivo. El servidor MCP lee esa cadena automáticamente al iniciar.

> [!NOTE]
> El archivo `.env` **no se sube nunca a Git** y no se comparte. Es local a tu dispositivo.

#### Dónde se carga según el agente

| Agente / cliente | Dónde va la cadena | Qué hace |
|---|---|---|
| **opencode** | Archivo `.env` del proyecto (el bloque MCP usa `cwd` apuntando a la raíz del repo) | El plugin/autor lanzan `node src/stdio.js` con `cwd` en el repo y `dotenv` lee el `.env` |
| **Copilot (VS Code)** | Archivo `.env` del proyecto (bloque MCP con `cwd` a la raíz del repo) | El servidor se lanza con `cwd` en el repo y `dotenv` lee el `.env` |
| **npx / modo local** | Archivo `.env` en la raíz del repositorio | El servidor la lee con `dotenv` |

**Si el agente no encuentra la cadena, el servidor no arranca.** Siempre verificá que `DATABASE_URL` esté cargada en el lugar correcto de cada dispositivo.

#### Cómo funciona la privacidad entre dispositivos

- **Todos tus dispositivos con la MISMA cadena** → ven los **mismos chats**. Si configurás tu notebook y tu celular con la misma `DATABASE_URL`, ambos comparten el mismo historial.
- **Dispositivos con cadenas DISTINTAS** → son bases **separadas**. Si otra persona tiene una cadena diferente, no puede ver tus datos, y viceversa.
- **El "aislamiento" no es una configuración aparte**: es simplemente tener cada quien su propia cadena. Mientras la cadena no se comparta, los datos no se mezclan.

#### Un consejo para no romper el aislamiento

- **Compartí la cadena solo con quien quieras que vea tus datos** (por ejemplo: tu otro dispositivo o un asistente de confianza).
- **Nunca la pegues en un chat, un ticket, una captura o un repositorio público.** Si se filtra, creá una nueva base en Neon y cambiá la cadena en todos tus dispositivos.

---

# Troubleshooting / Problemas comunes

### Node.js anterior a 20

**Síntoma:** al ejecutar `npm install` con un Node incompatible, npm puede mostrar una advertencia de engine como:

```text
npm WARN EBADENGINE Unsupported engine {
npm WARN EBADENGINE   required: { node: '>=20' },
npm WARN EBADENGINE   current: { node: '...' }
npm WARN EBADENGINE }
```

El repositorio declara `"engines": { "node": ">=20" }`. Con la configuración normal de npm, esto es una advertencia y no necesariamente impide la instalación; si tenés `engine-strict=true`, npm puede rechazarla. El propio Node.js no emite un error específico por el campo `engines`; el problema aparece cuando npm valida esa restricción o cuando el código utiliza una API/sintaxis no disponible en una versión vieja.

**Solución:** instalá Node.js 20 o superior y verificá con `node --version` antes de continuar.

### `DATABASE_URL` incorrecta o Neon inaccesible

**Síntoma:** `scripts/migrate.js` mantiene el error técnico original del driver `pg`. No existe un único mensaje porque depende de la falla: por ejemplo, puede aparecer `ENOTFOUND` si no se resuelve el host, `ECONNREFUSED` si la conexión es rechazada o `password authentication failed for user ...` si las credenciales no son válidas. El servidor ahora imprime antes:

```text
No se pudo conectar a la base de datos. Revisá que DATABASE_URL en tu .env sea correcta y que el proyecto de Neon esté activo.
```

Debajo se conserva el error técnico completo de `pg`, incluido su stack cuando el runtime lo proporciona.

**Solución:** revisá que `DATABASE_URL` sea exactamente la connection string de Neon, que no tenga caracteres modificados o truncados y que el proyecto de Neon esté activo/accesible. Si querés aislar el problema, también podés ejecutar `npm run migrate` directamente.

Si falta completamente `DATABASE_URL`, el comportamiento es distinto y deliberado: `scripts/migrate.js` falla con `DATABASE_URL environment variable is required.`.

### Primera conexión lenta después de inactividad en Neon Free

**Síntoma:** la primera conexión o el primer arranque después de un período de inactividad puede tardar bastante más de lo habitual mientras la instancia de Neon vuelve a estar disponible. Esto no significa por sí mismo que la configuración esté rota.

**Solución:** esperá a que termine el primer intento y volvé a probar si es necesario. Si después de esperar la conexión falla, aplicá el diagnóstico del caso anterior y revisá el error técnico de `pg`.

### No hay proveedor LLM configurado

**Síntoma:** si no hay `OPENROUTER_API_KEY` ni `GEMINI_API_KEY` disponibles, el almacenamiento y la recuperación normal del historial siguen funcionando: no necesitan un LLM.

Lo que se degrada es la funcionalidad que requiere generación/análisis. En `finalizeSession`, si el LLM no está disponible o falla, no se crea un resumen artificial y se devuelve:

```text
No se generó resumen: LLM no disponible.
```

con `summaryGenerated: false`, `auditRequired: false` y `summaryPending: true`. En , un fallo del LLM se registra y la extracción devuelve una lista de candidatos vacía. Como la auditoría de memoria técnica externa se activa a partir de una finalización con `auditRequired: true`, sin resumen generado la auditoría automática no se ejecuta en ese momento.

**Solución:** configurá al menos uno de los proveedores, por ejemplo `OPENROUTER_API_KEY` o `GEMINI_API_KEY`, y opcionalmente `AI_PROVIDER`/`AI_MODEL` según el proveedor que quieras usar. No necesitás un LLM para guardar ni recuperar el historial conversacional normal.

### Primera carga del modelo de embeddings

**Síntoma:** la primera vez que se guarda un mensaje, o la primera búsqueda semántica que necesita generar embeddings, puede tardar bastante más de lo esperado. En modo stdio, el worker de embeddings se inicia automáticamente salvo que definas `ENABLE_EMBEDDING_WORKER=false`, por lo que esta carga puede ocurrir al guardar el primer mensaje sin que hagas una acción explícita. Durante la carga el servidor ya registra `Loading embedding model: Xenova/all-MiniLM-L6-v2` y, cuando termina, `Embedding model loaded.`.

**Explicación:** la primera ejecución del pipeline de embeddings descarga desde Hugging Face Hub los archivos del modelo si todavía no están en caché local. No es un error y las cargas posteriores reutilizan el modelo cacheado, por lo que normalmente son mucho más rápidas. Transformers.js usa por defecto el directorio `.cache` para su caché de archivos en Node.js, relativo al directorio de trabajo del proceso; este proyecto no configura un directorio de caché diferente.

**Solución:** si es la primera ejecución, esperá a que termine la descarga y asegurate de que el entorno tenga salida a internet. Si el entorno no puede acceder a Hugging Face Hub, la descarga del modelo no podrá completarse. En ese caso podés desactivar el worker con `ENABLE_EMBEDDING_WORKER=false` para seguir usando el almacenamiento y la recuperación del historial sin generar embeddings semánticos.
# Configuración obligatoria para agentes

Para garantizar la integridad y separación de datos entre diferentes proyectos:

### 1. Utilizar el MCP para consultas históricas

Cuando el agente necesite información sobre conversaciones anteriores, debe utilizar las herramientas de `conversation-memory-mcp`.

El historial persistente no debería reconstruirse utilizando únicamente la memoria interna del agente o archivos arbitrarios del sistema.

### 2. `project` obligatorio

Todas las herramientas utilizan `project` para aislar los datos.

El servidor rechaza llamadas que no tengan un proyecto válido.

Además, si un `sessionId` pertenece a otro proyecto, la operación falla con `PROJECT_CONFLICT`.

Esto evita mezclar accidentalmente conversaciones de proyectos diferentes.

Ejemplo de instrucción para un agente:

> "Cuando necesites información histórica de este proyecto, utiliza las herramientas del MCP `conversation-memory`. Incluye siempre el parámetro `project` en las llamadas para mantener el aislamiento de datos."

---

# Cómo recupera conversaciones y resúmenes anteriores

`conversation-memory-mcp` conserva tanto los **mensajes originales** como los **resúmenes de sesión**. El agente no debería volver a resumir todos los turnos cada vez que necesita recordar algo.

### Preguntas generales sobre una sesión o un período

Si existe un resumen de la sesión correspondiente, el agente debe utilizarlo primero.

Por ejemplo:

> "¿Qué hicimos ayer?"

El flujo recomendado es:

```text
Pregunta histórica
      ↓
Buscar sesiones/resúmenes relevantes
      ↓
¿Existe resumen?
   ┌──┴──┐
  Sí     No
   ↓      ↓
Usarlo  Buscar mensajes originales
   └──┬──┘
      ↓
    Agente
      ↓
Respuesta
```

Esto evita enviar nuevamente todos los turnos al LLM solo para reconstruir una sesión que ya tiene un resumen persistente.

### Preguntas específicas

Cuando la pregunta requiere precisión sobre algo concreto, el agente puede buscar los **mensajes originales relevantes** aunque exista un resumen.

Por ejemplo:

> "¿Qué error encontramos ayer con ?"

En ese caso, puede utilizar `searchMessages` o `semanticSearchMessages` para recuperar el contexto específico.

### Si no existe un resumen

Si una sesión todavía no tiene resumen, el agente puede recuperar sus mensajes originales y construir la respuesta a partir de ellos. Esto **no crea automáticamente un nuevo resumen persistente**: el resumen se genera mediante `finalizeSession` cuando corresponde.

### Principio

```text
Resumen existente → usarlo primero para preguntas generales
Mensajes originales → usar cuando hace falta precisión
Sin resumen → recuperar mensajes y responder con ese contexto
```

La respuesta la genera el **agente en el momento**. `conversation-memory-mcp` proporciona el contexto persistente; no reemplaza al modelo que responde al usuario.

---

# Guardado automático en cualquier agente

El servidor **no guarda turnos automáticamente por sí mismo**.

Solo persiste información recibida mediante `saveMessage`.

Por lo tanto, en clientes que no tengan plugins, hooks o automatizaciones propias, el agente debe recibir una instrucción que le indique cuándo utilizar `saveMessage`.

El patrón recomendado es:

1. Guardar el mensaje del usuario.
2. Conservar el `messageId` devuelto.
3. Guardar posteriormente la respuesta del asistente utilizando `relatedMessageId`.
4. Mantener el mismo `sessionId` durante la sesión.
5. Utilizar siempre el `project` correspondiente.
6. Identificar el agente mediante `agentId`.
7. Evitar guardar mensajes sin valor de recuperación, como saludos o confirmaciones triviales.

Ejemplo:

> "Guardá en este MCP de memoria cada turno de conversación que tenga contenido sustancioso usando `saveMessage`.
>
> 1. Llamá `saveMessage` con el mensaje del usuario y anotá el `messageId`.
> 2. Llamá `saveMessage` con tu respuesta utilizando ese `messageId` como `relatedMessageId`.
> 3. Usá el mismo `sessionId` durante toda la sesión.
> 4. Incluí siempre `project`.
> 5. Identificate mediante tu `agentId`.
> 6. Omití saludos, confirmaciones cortas y mensajes sin valor de recuperación."

Este es el patrón de **guardado por instrucción al agente**.

Los clientes que dispongan de plugins, hooks o mecanismos propios de captura pueden automatizar este proceso.

## Lectura de historial: no usar `agentId` como filtro obligatorio

Al consultar el historial (`recoverSession`, `searchMessages`, `semanticSearchMessages`, `lastSession`, `listSessions`, `getLastSessionContext`), **no pases `agentId`** salvo que el usuario lo pida explícitamente por agente (p. ej. "la última charla con copilot").

- `agentId` es metadata de trazabilidad que se guarda en cada turno, no un filtro obligatorio de lectura.
- La lectura base se hace con `project` y/o `sessionId` (o la última sesión del proyecto); así se recupera todo el historial, de todos los agentes.
- Pasar `agentId` sin que se pida puede devolver vacío aunque existan mensajes/sesiones reales de otros agentes (falsos vacíos).

---

# Guardado automático con plugin (opencode y agentes con plugins)

El repositorio incluye un **plugin para opencode** en `plugins/conversation-memory.ts` que automatiza el guardado: cada turno sustancioso se persiste solo cuando la sesión queda inactiva. No depende de que el agente se acuerde de llamar a `saveMessage`.

El plugin **prefiere el MCP local `conversation-memory-local`** (stdio → tu Neon) y solo usa un endpoint HTTP remoto si encuentra `conversation-memory` en la configuración. No necesita Render ni ningún servidor externo.

## Requisitos

Para usar el plugin en un dispositivo necesitás:

1. El código del repositorio (el plugin lanza `node src/stdio.js` de este repo).
2. El archivo `plugins/conversation-memory.ts` copiado en la carpeta de plugins de opencode.
3. La dependencia `@modelcontextprotocol/sdk` en el entorno de plugins de opencode.
4. El bloque `conversation-memory-local` en la configuración de opencode.
5. La `DATABASE_URL` en el archivo `.env` de la raíz del repositorio.

## Instalación en el dispositivo actual

El repositorio incluye un instalador que hace los pasos 2 a 4 automáticamente (copia el plugin, instala el SDK en el entorno de opencode y agrega el bloque MCP con `cwd` al repo):

```bash
npm run install:plugin
```

Requisitos previos: tener `node`/`npm` instalados y el repositorio clonado.

### Qué hace el instalador (y qué tenés que hacer vos)

- Clona/descarga este repositorio (clonar ya trae el código del server y el plugin).
- Ejecutá `npm install` en el repo (lo hace el script si no está).
- El script copia `plugins/conversation-memory.ts` a `~/.config/opencode/plugins/`, instala `@modelcontextprotocol/sdk` en `~/.config/opencode` si faltara, y agrega el bloque `conversation-memory-local` a `~/.config/opencode/opencode.jsonc` con `cwd` apuntando a tu repo.
- Tu única tarea: pegar la `DATABASE_URL` en el `.env` del repo (`cp .env.example .env`).

El bloque que deja el instalador en `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "mcp": {
    "conversation-memory-local": {
      "type": "local",
      "command": ["node", "<ruta-al-repositorio>/src/stdio.js"],
      "cwd": "<ruta-al-repositorio>",
      "enabled": true
    }
  }
}
```

La cadena de conexión NO va en la configuración de opencode: va en el archivo `.env` de la raíz del repositorio (`cp .env.example .env` y pegá tu `DATABASE_URL`). El plugin lanza el servidor con `cwd` en el repo y `dotenv` lee el `.env`. No hace falta variable de entorno del sistema.

Reiniciá opencode. El plugin usa el MCP local `conversation-memory-local`, que conecta a tu base a través del `.env` del repo.

### Guardado automático y finalización a pedido

El plugin solo guarda el **historial crudo** automáticamente: cuando la sesión queda idle y hubo mensajes nuevos, persiste el par usuario/assistant en Neon (y sus embeddings). No genera resúmenes por su cuenta ni escribe en memoria técnica externa.

La **finalización de sesión es a pedido explícito del usuario** ("finalizá la sesión", "seguimos mañana", "después nos vemos", etc.):

1. El agente obtiene el `sessionId` (si no lo tiene, con `lastSession`) y llama `finalizeSession`.
2. `finalizeSession` genera un resumen **incremental**: solo resume los mensajes posteriores al último resumido (usa `last_processed_seq_id`). Por eso, cuando ya existe un resumen, no vuelve a procesar toda la sesión.
3. Si el LLM está disponible, se guarda el nuevo resumen y  queda en `true` para que el agente pueda ejecutar la auditoría de memoria técnica externa si memoria técnica externa está disponible.
4. Si el LLM **no está disponible o falla**, la sesión y sus mensajes igualmente quedan guardados, pero no se genera un resumen artificial, no se ejecuta la auditoría automática de memoria técnica externa y los mensajes quedan pendientes para poder resumirse más adelante cuando vuelva a estar disponible un LLM.

El resumen usa el LLM configurado. En OpenRouter, el modelo predeterminado es **Nemotron 120B gratuito** (`nvidia/nemotron-3-super-120b-a12b:free`), sujeto a la cuota y disponibilidad del proveedor. Podés cambiarlo con `AI_MODEL` o cambiar de proveedor con `AI_PROVIDER`.

### Auditoría automática de memoria técnica externa al finalizar

La sesión puede finalizarse para generar o actualizar su resumen; si el LLM no está disponible, el historial igualmente permanece guardado.

 no modifica memoria técnica externa por sí mismo. El agente interpreta el resultado y utiliza las tools reales de memoria técnica externa cuando corresponda:

- `missing` → `mem_save` si representa conocimiento durable importante.
- `already_exists` → no crear duplicados.
- `related` → `mem_save` solo si aporta conocimiento durable nuevo y relevante.
- `possible_duplicate` → resolver con las capacidades disponibles de memoria técnica externa, sin guardar duplicados a ciegas.
- `conflict` → utilizar `mem_judge` antes de modificar la memoria.
- Si una decisión o configuración durable existente cambió de forma relevante → utilizar la tool de actualización disponible, por ejemplo `mem_update`.

No es necesario llamar primero a :  realiza esa extracción internamente.

> [!NOTE]
> La auditoría automática depende de que exista un LLM disponible para finalizar la sesión. Si `finalizeSession` no puede generar el resumen por falta de LLM,  es `false` y la auditoría automática no se aplica en ese momento.

> [!NOTE]
> El monitor de sesiones inactivas (solo modo HTTP) está desactivado por defecto; para reactivarlo, `ENABLE_SESSION_MONITOR=true`.

## Misma memoria en otro dispositivo

Como los datos viven en tu base de Neon, configurar otro dispositivo con **la misma `DATABASE_URL`** hace que ambos compartan el mismo historial:

1. Cloná el repositorio en el nuevo dispositivo.
2. Copiá la cadena en el `.env` del repo clonado: `cp .env.example .env` y pegá tu `DATABASE_URL` (la misma que usás en este dispositivo).
3. Ejecutá `npm install` y luego `npm run install:plugin` (copia el plugin, instala el SDK y agrega el bloque MCP con `cwd` a la ruta local del repo).
4. Reiniciá opencode y verificá: pedile al agente que busque un mensaje guardado desde el otro dispositivo, por ejemplo `PROJECT_A_SECRET_63842` en el proyecto `proyecto-A`.

> [!NOTE]
> Con cadenas **distintas** los dispositivos ven bases **separadas**. La cadena es la que define privacidad y compartición: solo quienes tengan la misma `DATABASE_URL` en su `.env` comparten el historial.

## Otros agentes que aceptan plugins

Si tu agente soporta plugins o hooks (por ejemplo Copilot, Cursor, Claude Desktop), el mismo principio aplica:

1. Configurá el MCP `conversation-memory-local` apuntando a `node <ruta-al-repo>/src/stdio.js`, con `cwd` en la raíz del repositorio.
2. La `DATABASE_URL` va en el `.env` de la raíz del repositorio (no en la config del agente).
3. Usá un plugin/hook propio del agente para llamar a `saveMessage`, o el patrón de guardado por instrucción de la sección anterior si no tiene automatización.

---

# Aislamiento por proyecto

El parámetro `project` es una pieza fundamental del diseño.

Cada conversación queda asociada a un proyecto y las operaciones se validan contra ese proyecto.

Esto permite que diferentes agentes trabajen sobre diferentes proyectos sin mezclar sus historiales.

Por ejemplo:

```text
project: conversation-memory-mcp
project: tiktok-mcp
project: backend-ecommerce
project: portfolio
```

Un `sessionId` asociado a un proyecto no puede utilizarse accidentalmente desde otro proyecto.

---

# Herramientas disponibles

## Historial

### `saveMessage`

Guarda un mensaje en el historial persistente.

`project` es obligatorio.

### `searchMessages`

Busca mensajes mediante palabras clave o búsqueda semántica.

### `semanticSearchMessages`

Realiza búsquedas semánticas utilizando embeddings y pgvector.

### `searchSessionsBySummary`

Busca sesiones mediante sus resúmenes semánticos y permite recuperar el historial correspondiente. Es especialmente útil para preguntas generales sobre sesiones anteriores cuando ya existe un resumen.

### `lastSession`

Obtiene la última sesión del proyecto.

### `recoverSession`

Recupera el historial completo de una sesión determinada.

### `getLastSessionContext`

Recupera el contexto completo de la última sesión.

### `listSessions`

Lista las sesiones disponibles de un proyecto.

---

# Memoria durable

## 

Recupera información de una sesión y prepara candidatos de memoria semántica durable.

Los candidatos pueden representar:

* `decision`
* `discovery`
* `constraint`
* `configuration`
* `lesson`

Esta herramienta **no guarda directamente la memoria en memoria técnica externa**.

Su objetivo es identificar qué conocimiento de una conversación podría ser útil más allá de esa conversación.

---

## 

Audita los candidatos de memoria antes de promoverlos.

Permite determinar si una memoria:

* no existe;
* ya existe;
* está relacionada con otra;
* puede ser un duplicado;
* entra en conflicto;
* está pendiente de revisión;
* debe descartarse.

El auditado se persiste en PostgreSQL.

 **no escribe directamente en memoria técnica externa**.

En el flujo automático de finalización, se ejecuta cuando el resumen se pudo generar, memoria técnica externa está disponible y el agente recibe `auditRequired: true`.

---

## 

Promueve candidatos auditados hacia el proveedor de memoria durable configurado.

Cuando memoria técnica externa está habilitado, puede utilizarse como proveedor de memoria durable.

La operación es idempotente y permite evitar promociones duplicadas.

Si memoria técnica externa no está disponible, `conversation-memory-mcp` puede continuar funcionando como sistema de memoria conversacional.

---

# Resúmenes y eliminación

También están disponibles herramientas para administrar el ciclo de vida de las sesiones:

* `saveSessionSummary`
* `getSessionSummary`
* `finalizeSession`
* `deleteSession`
* `deleteMessage`
* `deleteMessagePair`

Todas las operaciones relacionadas con datos utilizan `project` para mantener el aislamiento.

La finalización (`finalizeSession`) se ejecuta **a pedido del usuario**, no automáticamente en el modo stdio habitual.

El resumen es **incremental**: si ya existe un resumen, solo se procesan los mensajes posteriores a `last_processed_seq_id`.

Si el LLM no está disponible, `finalizeSession` no genera un resumen artificial ni avanza el cursor de mensajes resumidos. De esa forma, el contenido queda pendiente y puede procesarse cuando vuelva a estar disponible un LLM.

---

# Embeddings

Los embeddings se generan desde los mensajes persistidos mediante el worker interno.

Los embeddings permiten realizar búsquedas semánticas mediante **pgvector**.

Cuando un embedding no está disponible, determinadas búsquedas pueden utilizar mecanismos alternativos de búsqueda textual.

---

# Arquitectura de memoria

`conversation-memory-mcp` está pensado principalmente como una **memoria conversacional persistente**.

Esto es diferente de una memoria técnica o semántica durable.

Por eso el proyecto puede trabajar junto con **memoria técnica externa**, creado por Alan Buscaglia, en lugar de intentar reemplazarlo.


## ¿Por qué utilizar memoria técnica externa y conversation-memory-mcp juntos?

Los dos sistemas resuelven problemas relacionados con la memoria de los agentes, pero desde **niveles diferentes**.

### `conversation-memory-mcp`

Se ocupa principalmente de:

* historial completo de conversaciones;
* recuperación de sesiones;
* búsqueda de mensajes;
* búsqueda semántica;
* contexto conversacional;
* aislamiento por proyecto;
* identificación de agentes;
* persistencia de las conversaciones en PostgreSQL + pgvector.

En otras palabras:

> **¿Qué se dijo o qué ocurrió durante una conversación anterior?**

### memoria técnica externa

Se ocupa principalmente de convertir determinados conocimientos importantes en **memoria durable**:

* decisiones;
* descubrimientos;
* restricciones;
* configuraciones;
* lecciones;
* problemas resueltos;
* conocimiento técnico que debe sobrevivir a múltiples sesiones.

En otras palabras:

> **¿Qué conocimiento técnico importante debemos recordar para el futuro?**

### Juntos

El flujo de finalización puede ser:

```text
Sesión actual
     │
     ▼
finalizeSession
     │
     ├── LLM no disponible → resumen pendiente, sin auditoría
     │
     └── resumen generado
              │
              ▼
     memoria técnica externa disponible?
              │
              ▼
        memoryAudit
              │
       ┌──────┼─────────┐
       │      │         │
    missing conflict related/existing
       │      │         │
       ▼      ▼         ▼
  mem_save  mem_judge  decidir si mem_save
       │      │         │
       └──────┴─────────┘
              │
              ▼
        memoria técnica externa durable
```

La auditoría no convierte automáticamente cada conversación en memoria durable. El agente interpreta los resultados y utiliza las herramientas propias de memoria técnica externa (`mem_save`, `mem_update`, `mem_judge`, cuando estén disponibles) para decidir qué conocimiento debe persistir.

Esto permite mantener una separación clara:

```text
Conversación completa
        ↓
conversation-memory-mcp

Conocimiento técnico durable
        ↓
memoria técnica externa
```

La ventaja de combinarlos es evitar dos problemas opuestos:

1. **Guardar absolutamente todo como memoria durable**, generando ruido y dificultando la recuperación de conocimiento importante.
2. **Guardar solamente memorias resumidas**, perdiendo el historial conversacional necesario para reconstruir qué se dijo, cuándo se dijo y en qué contexto ocurrió.

De esta forma, `conversation-memory-mcp` puede funcionar como la **fuente de historial conversacional**, mientras que memoria técnica externa funciona como una **capa de conocimiento técnico durable**.

La integración está diseñada para que memoria técnica externa sea opcional. `conversation-memory-mcp` puede funcionar sin memoria técnica externa y mantener su capacidad de almacenar y recuperar conversaciones.

---

# Ejemplo de flujo

Un agente trabaja en un proyecto:

```text
Usuario
   │
   ▼
Agente
   │
   ├── saveMessage()
   ├── saveMessage()
   │
   ▼
conversation-memory-mcp
   │
   ▼
PostgreSQL + pgvector
```

Al finalizar una sesión:

```text
Agente
   │
   ▼
finalizeSession()
   │
   ├── LLM disponible
   │      ↓
   │   resumen incremental
   │      ↓
   │   auditRequired=true
   │      ↓
   │   memoryAudit()
   │      ↓
   │   Agente + tools de memoria técnica externa
   │
   └── LLM no disponible
          ↓
       resumen pendiente
          ↓
       auditRequired=false
```

Más adelante, si el agente necesita recuperar información:

```text
Pregunta general sobre una sesión anterior
        │
        ▼
searchSessionsBySummary()
        │
        ├── hay resumen → usar resumen
        │
        └── no hay resumen → buscar mensajes
```

Si necesita precisión sobre un hecho concreto:

```text
Pregunta específica
        │
        ▼
searchMessages() / semanticSearchMessages()
        │
        ▼
Mensajes relevantes
        │
        ▼
Agente
```

Así, el historial completo permanece disponible en `conversation-memory-mcp`, mientras que los resúmenes evitan reprocesar innecesariamente sesiones completas y el conocimiento técnico seleccionado puede convertirse en memoria durable mediante memoria técnica externa.

---

# Avanzado: servidor HTTP multi-tenant

> Esta sección aplica solo si se necesita un **servidor HTTP compartido** para múltiples usuarios, por ejemplo desplegado en un VPS. **No es necesario para el uso habitual con npx.**

En este modo, el servidor expone un endpoint HTTP y valida `api_keys` por usuario. El `DATABASE_URL` vive solo en el servidor y los usuarios reciben tokens limitados (nunca ven las credenciales de la base).

### Token master

El token `MCP_BEARER_TOKEN` en el `.env` del servidor da acceso admin a todos los datos de todos los owners.

### API keys por usuario

```bash
node scripts/create-api-key.js new --name "maxi-portatil" --owner "maxi" --project "tiktok-mcp"
```

Si no se pasa `--owner`, se usa `MCP_DEFAULT_OWNER`.

### Aislamiento por usuario (`owner`)

Cada API key pertenece a un **owner**. Todos los datos quedan asociados al **owner del token** que los escribió. Un usuario solo puede leer/escribir sus propios datos dentro del proyecto que su token autoriza.

```text
Token master (MCP_BEARER_TOKEN)  → owner = null  → acceso ADMIN a todo
Token de api_key con owner "maxi" → datos aislados a owner="maxi"
```

El `owner` **nunca se recibe de los parámetros del request**: se deriva del token autenticado.

### Gestión de API keys

Listar:

```bash
node scripts/create-api-key.js list
```

Revocar:

```bash
node scripts/create-api-key.js revoke <id>
```

El token en texto plano se muestra **una sola vez** durante su creación y no puede recuperarse posteriormente.

### Configuración del cliente (HTTP)

```jsonc
{
  "mcpServers": {
    "conversation-memory": {
      "type": "http",
      "url": "https://tu-servidor.com/mcp",
      "headers": {
        "Authorization": "Bearer <token-del-usuario>"
      }
    }
  }
}
```

---

# Desarrollo

## Stack

* Node.js
* Express
* Model Context Protocol SDK
* Zod
* PostgreSQL
* Neon
* pgvector

La base de datos utiliza PostgreSQL con `pgvector` para búsquedas semánticas mediante embeddings.

---

# Filosofía del proyecto

`conversation-memory-mcp` no intenta convertir cada interacción del agente en una memoria durable.

Su objetivo principal es mantener una **fuente persistente y recuperable del historial conversacional**.

La capa de memoria durable es una responsabilidad diferente.

Por eso el proyecto puede funcionar de forma independiente o combinarse con sistemas como memoria técnica externa:

```text
                    AGENTE
                       │
          ┌────────────┴────────────┐
          │                         │
          ▼                         ▼
conversation-memory-mcp          memoria técnica externa
          │                         │
          ▼                         ▼
Historial conversacional     Conocimiento durable
          │                         │
          └────────────┬────────────┘
                       │
                       ▼
                Contexto útil
                para el agente
```

La combinación permite conservar tanto **la historia de lo que ocurrió** como **el conocimiento que vale la pena recordar**.

---

# Licencia

Consultar la licencia del repositorio para conocer las condiciones de uso, modificación y distribución.
