# Compatibilidad de captura y verificación

## Alcance de 1.2.0

- OpenCode: selección por `--version`, entradas separadas V1/V2, runtime persistente y dependencias aisladas.
- Claude Code: Stop con transcript JSONL. Se almacenan texto de usuario/asistente e identificadores de origen, no thinking ni tool results.
- Cursor: prompt y respuesta por conversation_id/generation_id. El estado pendiente se conserva en la configuración privada del usuario.
- Gemini CLI: AfterAgent con transcript JSON y respuesta final; no pensamientos ni llamadas a herramientas.
- Codex: UserPromptSubmit/Stop con turn_id; no depende del formato inestable del rollout.
- Copilot CLI y motor Copilot actual de VS Code: agentStop y transcript de eventos; no se certifica el motor local legado de VS Code.
- Qwen Code: Stop con JSONL y UUID, excluyendo tool_result, thinking y mensajes internos.
- Kimi Code CLI: Stop global. Se localiza la sesión por su ID exacto. Se prefiere wire.jsonl; el fallback context.jsonl en versiones antiguas utiliza contenido + ocurrencia y tiene límites frente a compactación/edición del historial.
- Windsurf: post_cascade_response_with_transcript; directorio del proceso según el contrato del host. Se excluyen code_action y otras herramientas. El host genera su propia copia completa del transcript.
- Hermes: post_llm_call, extra.turn_id/user_message/assistant_response. YAML conserva comentarios y hooks ajenos. Shim Python para lanzamiento en Windows sin confundir un .cmd con un ejecutable nativo.
- Kilo: plugin con server y session.idle, cliente SDK raíz. Se contrastó el contrato publicado de @kilocode/plugin y @kilocode/sdk 7.8.27; se obtiene el directorio de la sesión para aislar proyectos.
- OpenClaw: plugin nativo con manifest y agent_end, permiso allowConversationAccess. Respeta omisión de mensajes en incógnito; no certifica backends que no entreguen mensajes o identidad/directorio.
- Pi: extensión descubierta mediante package.json pi.extensions. Captura entradas persistidas de la rama por ID. Conexión MCP de lectura sigue siendo manual.
- Trae CN: opción explícita trae-cn, UserPromptSubmit/Stop. Conexión MCP manual. Al no documentarse un ID de turno en ambos eventos, usa estado local; no certifica entrega exactamente una vez de prompts duplicados fuera de orden.
- Kiro IDE y Antigravity: hooks existentes, extracción de respuesta/transcript aún no comprobada; conservan instrucciones con explicación explícita. Trae internacional y genérico tampoco anuncian captura automática.

Los adaptadores nuevos se validan con fixtures de contratos oficiales y con el CLI
real contra base temporal. Esto no significa que se hayan ejecutado conversaciones
con modelos dentro de todos los productos, ni que cualquier versión histórica
admita estos hooks. El usuario debe habilitarlos/confiar en ellos en el host.

La cola local guarda mensajes visibles antes de acceder a PostgreSQL, conserva
fallos y reintenta al llegar nuevos eventos del mismo proyecto. Tiene presupuesto
de tiempo/lotes y exclusión mutua entre procesos. No hay un proceso permanente;
si se cierra el agente, los pendientes esperan al siguiente evento. Los archivos
de estado/pendientes contienen texto plano en la configuración privada.
Los hooks de shell usan además un lanzador Node persistente, sin dependencias npm,
que guarda los campos necesarios de entrada antes de ejecutar npx. Esto permite
recuperar entradas cuando npm no arranca, tarda demasiado o no tiene red. No se
conserva extra.conversation_history de Hermes. El acuse interno confirma que el
proceso de captura ya guardó un pendiente canónico antes de retirar la entrada.

El soporte de hooks requiere una versión del host que implemente los eventos y
campos documentados. OpenCode selecciona por major estable (1/2); los SDK usados
para contrastar los contratos fueron 1.19.5 y 2.2.6. No se certifican todas las
versiones anteriores ni servicios cloud con APIs distintas. Deben autorizarse los
hooks según la política de confianza de cada aplicación.

## Comprobaciones

- Pruebas de instalador sobre directorios temporales: comentarios JSONC, otros MCP,
  configuración global/proyecto, idempotencia, cambio de API, versión desconocida,
  instalación fallida de dependencias y plugin manual duplicado.
- Adaptadores V1/V2 con eventos y mensajes del contrato publicado: captura, relación,
  deduplicación, exclusión de razonamiento y liberación al descargar.
- `node scripts/smoke-package.js`: empaqueta el candidato local, instala el tarball
  en una carpeta limpia, instala dependencias persistentes del plugin y ejecuta
  guardados reales mediante MCP stdio con ambas entradas. No usa npm @latest ni
  consume un modelo de IA. La configuración se aplica a ctx/cliente de prueba.
- Hooks nativos: formatos de entrada, emparejamiento, fallo del primer guardado,
  preservación de hooks ajenos, scope global/proyecto y CLI real contra schema de
  prueba de PostgreSQL.
- La CI configura estos controles en Linux, macOS y Windows. Una ejecución local
  en Windows no certifica por sí sola que esas ejecuciones remotas hayan pasado.

## Carga comprobada en ejecutables reales (Windows)

Se iniciaron OpenCode 1.19.5 y 2.2.6 con configuracion/datos aislados, sin usar
las sesiones del usuario ni enviar prompts a modelos. V1 registro la activacion
del plugin; V2 lo devolvio como `conversation-memory`, estado `active`, mediante
su API de plugins. Los guardados/deduplicacion se comprobaron por separado con
MCP stdio real y con las pruebas de contrato. Esto no certifica cada minor ni
una conversacion con un proveedor/modelo real.

## Fuentes de los contratos

- [Migración OpenCode V1/V2](https://opencode.ai/docs/build/plugins/migrate-v1/)
- [API de plugins OpenCode](https://opencode.ai/docs/build/plugins/server/)
- [Hooks Claude Code](https://code.claude.com/docs/en/hooks)
- [Hooks Cursor](https://cursor.com/docs/hooks)
- [Hooks Gemini CLI](https://geminicli.com/docs/hooks/reference/)
- [Hooks Codex](https://learn.chatgpt.com/docs/hooks)
- [Hooks Copilot](https://docs.github.com/en/copilot/reference/hooks-reference)
- [Hooks VS Code](https://code.visualstudio.com/docs/agent-customization/hooks)
- [Hooks Qwen Code](https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/hooks.md)
- [Hooks Kimi](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/hooks.html)
- [Fuente de sesiones Kimi](https://github.com/MoonshotAI/kimi-cli/blob/main/src/kimi_cli/session.py)
- [Hooks Hermes](https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks/)
- [Plugins Kilo](https://kilo.ai/docs/automate/extending/plugins)
- [Hooks OpenClaw](https://docs.openclaw.ai/plugins/hooks)
- [Extensiones Pi](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- [Hooks Windsurf](https://docs.windsurf.com/de/windsurf/cascade/hooks)
- [Hooks Trae CN](https://docs.trae.cn/ide_hook-configuration-reference)
- [Hooks Kiro](https://kiro.dev/docs/hooks/)
- [Hooks Antigravity](https://antigravity.google/docs/hooks)

Antes de publicar: ejecutar lint, la suite y el smoke del candidato; probar el
plugin dentro de las versiones reales que se quieran certificar. El cambio de
versión local no publica npm. No se realizó publicación desde este trabajo.
