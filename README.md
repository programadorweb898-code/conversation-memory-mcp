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

# Inicio rápido (npx + Neon personal)

Cada usuario crea su propia base de datos en **Neon** (plan gratuito) y ejecuta el MCP localmente con `npx`. **Los chats de cada persona nunca se mezclan porque están en bases de datos distintas.**

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
```

**No compartas este archivo ni lo subas a git.** Contiene las credenciales de tu base.

### 3. Ejecutar

```bash
npm install
npm start
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

Y recordá instructar al agente para que incluya `project` en cada llamada al MCP (ver [Configuración obligatoria para agentes](#configuración-obligatoria-para-agentes)).

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
| **opencode** | Variable de entorno del sistema (`DATABASE_URL`) o el archivo `.env` del proyecto | El agente la toma de `{env:DATABASE_URL}` en su configuración |
| **Copilot (VS Code)** | Variable de entorno del sistema (`DATABASE_URL`) | El agente la toma de `${env:DATABASE_URL}` en su configuración |
| **npx / modo local** | Archivo `.env` en la raíz del repositorio | El servidor la lee con `dotenv` |

**Si el agente no encuentra la cadena, el servidor no arranca.** Siempre verificá que `DATABASE_URL` esté cargada en el lugar correcto de cada dispositivo.

#### Cómo funciona la privacidad entre dispositivos

- **Todos tus dispositivos con la MISMA cadena** → ven los **mismos chats**. Si configurás tu notebook y tu celular con la misma `DATABASE_URL`, ambos comparten el mismo historial.
- **Dispositivos con cadenas DISTINTAS** → son bases **separadas**. Si otra persona tiene una cadena diferente, no puede ver tus datos, y viceversa.
- **El "aislamiento" no es una configuración aparte**: es simplemente tener cada quien su propia cadena. Mientras la cadena no se comparta, los datos no se mezclan.

#### Un consejo para no romper el aislamiento

- **Compartí la cadena solo con quien quieras que vea tus datos** (por ejemplo: tu otro dispositivo o un asistente de confianza).
- **Nunca la pegues en un chat, un ticket, una captura o un repositorio público.** Si se filtra, alguien podría conectarse a tu base. En ese caso, creá una nueva base en Neon y cambiá la cadena en todos tus dispositivos.

---

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
5. La `DATABASE_URL` apuntando a tu base Neon.

## Instalación en el dispositivo actual

```bash
mkdir -p ~/.config/opencode/plugins
cd ~/.config/opencode
npm init -y
npm install @modelcontextprotocol/sdk
cp <ruta-al-repo>/plugins/conversation-memory.ts ~/.config/opencode/plugins/
```

En `~/.config/opencode/opencode.jsonc` agregá el bloque MCP:

```jsonc
{
  "mcp": {
    "conversation-memory-local": {
      "type": "local",
      "command": ["node", "<ruta-al-repositorio>/src/stdio.js"],
      "enabled": true,
      "environment": {
        "DATABASE_URL": "{env:DATABASE_URL}"
      }
    }
  }
}
```

Reiniciá opencode. El plugin carga la variable `DATABASE_URL` del sistema y el servidor stdio la usa para conectar a tu base.

## Misma memoria en otro dispositivo

Como los datos viven en tu base de Neon, configurar otro dispositivo con **la misma `DATABASE_URL`** hace que ambos compartan el mismo historial:

1. Cloná el repositorio en el nuevo dispositivo y ejecutá `npm install`.
2. Cargá la `DATABASE_URL` en el sistema del nuevo dispositivo (misma cadena que ya usás):
   - Windows: `setx DATABASE_URL "tu-cadena"`
   - macOS/Linux: `export DATABASE_URL="tu-cadena"` en `~/.zshrc` o `~/.bashrc`
3. Repetí la instalación del plugin y el bloque `conversation-memory-local` (ajustando la ruta al repositorio del nuevo dispositivo).
4. Reiniciá opencode y verificá: pedile al agente que busque un mensaje guardado desde el otro dispositivo, por ejemplo `PROJECT_A_SECRET_63842` en el proyecto `proyecto-A`.

> [!NOTE]
> Con cadenas **distintas** los dispositivos ven bases **separadas**. La cadena es la que define privacidad y compartición: solo quienes tengan la misma `DATABASE_URL` comparten el historial.

## Otros agentes que aceptan plugins

Si tu agente soporta plugins o hooks (por ejemplo Copilot, Cursor, Claude Desktop), el mismo principio aplica:

1. Configurá el MCP `conversation-memory-local` apuntando a `node <ruta-al-repo>/src/stdio.js`.
2. Pasale la `DATABASE_URL` al servidor (variable de entorno o placeholder de tu agente).
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

Busca sesiones mediante sus resúmenes semánticos y permite recuperar el historial correspondiente.

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

## `extractMemories`

Recupera información de una sesión y prepara candidatos de memoria semántica durable.

Los candidatos pueden representar:

* `decision`
* `discovery`
* `constraint`
* `configuration`
* `lesson`

Esta herramienta **no guarda directamente la memoria en Engram**.

Su objetivo es identificar qué conocimiento de una conversación podría ser útil más allá de esa conversación.

---

## `memoryAudit`

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

`memoryAudit` **no escribe directamente en Engram**.

---

## `memoryPromote`

Promueve candidatos auditados hacia el proveedor de memoria durable configurado.

Cuando Engram está habilitado, puede utilizarse como proveedor de memoria durable.

La operación es idempotente y permite evitar promociones duplicadas.

Si Engram no está disponible, `conversation-memory-mcp` puede continuar funcionando como sistema de memoria conversacional.

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

---

# Embeddings

`generateAndSaveEmbedding` genera y almacena el embedding de un mensaje.

Los embeddings permiten realizar búsquedas semánticas mediante **pgvector**.

Cuando un embedding no está disponible, determinadas búsquedas pueden utilizar mecanismos alternativos de búsqueda textual.

---

# Arquitectura de memoria

`conversation-memory-mcp` está pensado principalmente como una **memoria conversacional persistente**.

Esto es diferente de una memoria técnica o semántica durable.

Por eso el proyecto puede trabajar junto con **Engram**, creado por Alan Buscaglia, en lugar de intentar reemplazarlo.

## Engram

[Engram — repositorio original de Alan Buscaglia](https://github.com/Gentleman-Programming/engram?utm_source=chatgpt.com)

**Engram** es un sistema de memoria persistente para agentes de IA. Su objetivo es evitar que el agente pierda entre sesiones conocimientos importantes como decisiones de arquitectura, bugs solucionados, descubrimientos, patrones y convenciones del proyecto.

Engram está diseñado para ser **agnóstico del agente** y utiliza MCP para que distintos agentes compatibles puedan acceder a esa memoria persistente. El proyecto nació precisamente para resolver el problema de que un agente vuelva a comenzar prácticamente desde cero en una nueva sesión.

Para conocer su arquitectura, instalación y configuración actual, consultar directamente el repositorio original de Engram:

[GitHub — Gentleman-Programming/engram](https://github.com/Gentleman-Programming/engram?utm_source=chatgpt.com)

---

## ¿Por qué utilizar Engram y conversation-memory-mcp juntos?

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

### Engram

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

El flujo puede ser:

```text
                    AGENTE
                       │
                       ▼
             conversation-memory-mcp
                       │
              Historial completo
                       │
                       ▼
              extractMemories
                       │
                       ▼
                memoryAudit
                       │
              ┌────────┴────────┐
              │                 │
          No existe         Ya existe /
              │              relacionado
              ▼                 │
       memoryPromote            │
              │                 │
              ▼                 │
           Engram ◄─────────────┘
```

Esto permite mantener una separación clara:

```text
Conversación completa
        ↓
conversation-memory-mcp

Conocimiento técnico durable
        ↓
Engram
```

La ventaja de combinarlos es evitar dos problemas opuestos:

1. **Guardar absolutamente todo como memoria durable**, generando ruido y dificultando la recuperación de conocimiento importante.
2. **Guardar solamente memorias resumidas**, perdiendo el historial conversacional necesario para reconstruir qué se dijo, cuándo se dijo y en qué contexto ocurrió.

De esta forma, `conversation-memory-mcp` puede funcionar como la **fuente de historial conversacional**, mientras que Engram funciona como una **capa de conocimiento técnico durable**.

La integración está diseñada para que Engram sea opcional. `conversation-memory-mcp` puede funcionar sin Engram y mantener su capacidad de almacenar y recuperar conversaciones.

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
   │
   ├── saveMessage()
   │
   ▼
conversation-memory-mcp
   │
   ▼
PostgreSQL + pgvector
```

Más adelante, el agente necesita recuperar información:

```text
Agente
   │
   ▼
searchMessages()
   │
   ▼
Historial persistente
```

Si durante una sesión se descubre una decisión técnica importante:

```text
Conversación
     │
     ▼
extractMemories
     │
     ▼
memoryAudit
     │
     ├── duplicado / existente
     │
     └── nueva memoria
              │
              ▼
       memoryPromote
              │
              ▼
           Engram
```

Así, el historial completo permanece disponible en `conversation-memory-mcp`, mientras que el conocimiento técnico seleccionado puede convertirse en memoria durable.

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

Cada API key pertenece a un **owner**. Todos los datos quedan asociados al `owner` del token que los escribió. Un usuario solo puede leer/escribir sus propios datos dentro del proyecto que su token autoriza.

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

Por eso el proyecto puede funcionar de forma independiente o combinarse con sistemas como Engram:

```text
                    AGENTE
                       │
          ┌────────────┴────────────┐
          │                         │
          ▼                         ▼
conversation-memory-mcp          Engram
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