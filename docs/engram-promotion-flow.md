# Flujo de promoción hacia Engram

`conversation-memory-mcp` separa el historial conversacional de la memoria técnica durable.

## Flujo canónico

```text
finalizeSession
      |
      v
 memoryAudit
      |
      +--> already_exists     -> no action
      +--> related            -> review before saving new knowledge
      +--> possible_duplicate -> resolve before saving
      +--> conflict           -> mem_judge / resolve
      +--> discard            -> no action
      +--> missing            -> memoryPromote
      |
      v
    Engram
```

### `memoryAudit`

Audita los candidatos contra la memoria durable existente y persiste el resultado en Neon. No escribe en Engram.

### `memoryPromote`

Es la ruta controlada para promover candidatos `missing` hacia el proveedor configurado mediante `MemoryAdapter`.

También controla la idempotencia de la promoción: una promoción repetida del mismo candidato no debe crear otra memoria.

### `pushToEngram`

No es una segunda vía de promoción. Es una herramienta de preparación manual: recupera un mensaje y genera una sugerencia de contenido para inspección o backfill.

No escribe en Engram y no debe utilizarse para reemplazar `memoryAudit` → `memoryPromote`.

## Regla para agentes

Cuando una sesión termina y `memoryAudit` identifica conocimiento nuevo como `missing`:

1. Verificar que el conocimiento sea durable y relevante.
2. Usar `memoryPromote` para ese candidato.
3. No llamar directamente a `mem_save` para el mismo candidato.

Las herramientas propias de Engram siguen siendo apropiadas para resolver conflictos, actualizar conocimiento existente o tratar casos `related`/`possible_duplicate` cuando corresponda.
