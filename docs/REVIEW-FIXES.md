# Correcciones de la revisión de integridad

Los cambios se aplican con las migraciones pendientes habituales. Se requiere
PostgreSQL 15 o posterior (la CI utiliza PostgreSQL 16 con pgvector).

| Punto | Comportamiento corregido | Verificación |
| --- | --- | --- |
| 1 | El borrado de una pregunta desvincula la respuesta sin borrar su identidad. | Integración con FK real. |
| 2 | Borrar mensajes invalida resumen y vector; una revisión de origen impide restaurarlos desde una generación antigua. | Invalidación y rechazo de revisión antigua. |
| 3 | Tests requieren TEST_DATABASE_URL y usan schemas cm_test_* únicos. | Rechazo de credenciales implícitas y schemas reservados. |
| 4 | El reindexado de resúmenes enlaza correctamente los parámetros de cursor. | Páginas SQL reales, con y sin owner. |
| 5 | El esquema MCP acepta los cursores numéricos que devuelve la búsqueda. | Validación de ambos esquemas públicos. |
| 6 | Todas las consultas usan inputType query para E5. | Mapeo de roles y pruebas de proveedor. |
| 7 | Los candidatos léxicos y semánticos se fusionan y deduplican antes del límite. | Búsqueda con indexación parcial. |
| 8 | Generación individual, generación en lote y escritura comprueban embedding_metadata. | Contrato incompatible rechazado en cada entrada. |
| 9 | La caché conserva los IDs MCP; sourceMessageId hace idempotentes los reintentos. | Caché recargada, guardados concurrentes y conflicto de contenido. |
| 10 | Una tarea local despierta el worker sin esperar el backoff de inactividad. | Temporizadores y desuscripción al apagar. |
| 11 | Los resúmenes manuales calculan su watermark y admiten correcciones con control de concurrencia. | Handler público sobre resumen generado. |
| 12 | El contexto reciente devuelve la cola de la conversación e indica truncamiento y cursor hacia atrás. | Paginación sin huecos y aislamiento por propietario. |

## Contratos y operación

- Los borrados invalidan datos derivados incluso si se hacen por SQL directamente.
  La siguiente finalización reconstruye el resumen desde los mensajes restantes.
- `sourceMessageId` identifica un mensaje del cliente dentro de owner, project y
  sessionId. Reutilizarlo con otro texto o rol es un conflicto, no una edición.
- Las entradas booleanas de cachés antiguas se conservan para evitar duplicados.
  No contienen un ID recuperable: los vínculos anteriores no se reconstruyen por
  conjetura. Los nuevos guardados persisten el mapeo completo.
- `saveSessionSummary` manual cubre los mensajes existentes al iniciar la
  operación. Si otra actualización o borrado cambia su fuente, se debe releer la
  sesión. Con embeddings deshabilitados elimina cualquier vector anterior.
- `getLastSessionContext` devuelve mensajes recientes en orden cronológico.
  Para continuar, reenviar sessionId y nextBeforeSequenceId como beforeSequenceId.
- Las puntuaciones de búsqueda híbrida son posiciones fusionadas, no una
  probabilidad ni similitud coseno pura. semanticScore conserva la señal original
  cuando está disponible.
- El wakeup del worker es local al proceso; el polling recupera trabajo de otras
  instancias. La coordinación distribuida de inferencia sigue siendo una mejora
  separada: varios workers pueden recalcular el mismo mensaje.
- La metadata de embeddings se valida antes de usar o guardar vectores. Cambiar
  de modelo requiere una migración explícita del contrato y reindexado controlado;
  el comando no actualiza metadata silenciosamente.

## Pruebas

Usar una base dedicada con pgvector y definir TEST_DATABASE_URL. TEST_SCHEMA es
un prefijo opcional cm_test o cm_test_*, no un schema existente. El teardown solo
elimina el schema único creado por esa ejecución. Si se interrumpe el proceso,
puede quedar ese schema de test para limpieza posterior.
