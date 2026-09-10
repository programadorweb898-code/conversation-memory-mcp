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

# ¿Por qué utilizar Engram y conversation-memory-mcp juntos?

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

# Uso para cualquier agente

Este MCP expone herramientas para persistir y recuperar conversaciones por proyecto.

Para utilizarlo desde cualquier agente o cliente MCP:

1. **Guardar turnos** con `saveMessage`.
2. Utilizar `project` para aislar los datos.
3. Utilizar `agentId` para identificar al agente que generó el mensaje.
4. Recuperar conversaciones mediante las herramientas de búsqueda y recuperación.
5. Opcionalmente convertir conocimiento relevante de una conversación en memoria durable mediante el flujo `extractMemories → memoryAudit → memoryPromote`.

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

# Multi-tenant: API keys por usuario y proyecto

Por defecto, el servidor puede protegerse mediante un token master:

```text
MCP_BEARER_TOKEN
```

Ese token puede tener acceso a todos los proyectos.

Para evitar compartir el token master con otros usuarios o dispositivos, el servidor también soporta **API keys específicas por usuario/proyecto**.

Cada API key puede tener:

* `name`
* `project`
* token propio
* estado `enabled`

Los tokens se almacenan mediante su **hash SHA-256**, no como texto plano.

### Token limitado a un proyecto

Un token puede estar asociado a un único proyecto.

En ese caso:

```text
Agente
   │
   │ token scoped
   ▼
conversation-memory-mcp
   │
   └── project permitido
```

Si el agente intenta acceder a otro proyecto, recibe:

```text
403
```

Si no especifica `project`, el servidor puede inyectar automáticamente el proyecto asociado al token.

### Revocación

Un token puede revocarse mediante:

```text
enabled = FALSE
```

Un token revocado recibe:

```text
401
```

---

# Gestión de API keys

Crear un token para un usuario/dispositivo:

```bash
node scripts/create-api-key.js new --name "maxi-portatil" --project "tiktok-mcp"
```

Crear un token con acceso global:

```bash
node scripts/create-api-key.js new --name "agente-interno"
```

Listar las keys:

```bash
node scripts/create-api-key.js list
```

Revocar un token:

```bash
node scripts/create-api-key.js revoke <id>
```

El token en texto plano se muestra **una sola vez** durante su creación y no puede recuperarse posteriormente.

---

# Configuración del cliente

Ejemplo para un cliente MCP compatible:

```jsonc
{
  "mcp": {
    "conversation-memory": {
      "type": "http",
      "url": "https://conversation-memory-mcp.onrender.com/mcp",
      "headers": {
        "Authorization": "Bearer <token-del-usuario>"
      }
    }
  }
}
```

Con un token scoped por proyecto, el agente no necesita enviar manualmente `project`; el servidor puede asociarlo automáticamente al token.

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
