# AGENTS.md

## Memoria conversacional

Cuando uses `conversation-memory-mcp`, mantené el aislamiento por proyecto y utilizá siempre el parámetro `project` en las llamadas al MCP.

Los turnos sustanciosos deben persistirse mediante `saveMessage` siguiendo las reglas documentadas en el README.

## Auditoría automática de Engram al finalizar una sesión

Al finalizar una sesión, después de llamar a `finalizeSession`, verificá si Engram está disponible en el proyecto.

- Si Engram **no está instalado, configurado o disponible**, no ejecutes la auditoría de Engram y continuá normalmente.
- Si Engram **sí está disponible** y `finalizeSession` indica que hay una auditoría pendiente (`auditRequired: true`), llamá a `memoryAudit` para la sesión actual.
- No es necesario llamar primero a `extractMemories`: `memoryAudit` realiza la extracción de candidatos internamente.

### Qué hacer con el resultado de `memoryAudit`

La auditoría no modifica Engram por sí misma. El agente debe interpretar el resultado y utilizar directamente las tools de Engram disponibles:

- `missing`: si el candidato representa conocimiento durable importante que todavía no está en Engram, guardarlo con `mem_save`.
- `already_exists`: no guardar nada para evitar duplicados.
- `related`: si el candidato aporta conocimiento durable nuevo y relevante, guardarlo con `mem_save`; si la información ya está suficientemente cubierta, no duplicarla.
- `possible_duplicate`: no crear otra memoria automáticamente; utilizar las capacidades de Engram para resolverlo cuando corresponda.
- `conflict`: utilizar `mem_judge` de Engram para resolver el conflicto antes de modificar la memoria.
- Cuando una decisión, configuración o conocimiento durable existente haya cambiado de forma relevante, actualizar la memoria correspondiente utilizando la tool de actualización de Engram disponible (por ejemplo, `mem_update`).
- Los casos descartados o no suficientemente relevantes no deben convertirse en memoria durable.

### Principios

1. Engram debe continuar funcionando normalmente durante la sesión; esta auditoría es una capa adicional de control al finalizarla.
2. La auditoría se refiere a la **sesión actual** y a las memorias durables existentes de Engram.
3. El objetivo es detectar conocimiento importante que faltó guardar, evitar duplicados y mantener actualizadas las decisiones relevantes del proyecto.
4. `conversation-memory-mcp` audita y devuelve el resultado; **el agente** es quien decide qué tool de Engram utilizar.
5. No inventes operaciones de Engram: utilizá únicamente las tools que el agente tenga realmente disponibles.
