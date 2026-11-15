import { createHash } from "node:crypto";
import { findMcpConfig } from "./opencode-config.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { createMcpClientManager } from "./mcp-client.js";
import { createSaveCache } from "./save-cache.js";
import { extractConfirmedMessageId } from "./save-confirmation.js";
import { resolveProjectIdentity } from "./projectIdentity.mjs";

const MCP_PREFIXES = ["conversation-memory-local_", "conversation-memory_"];

// Solo estas tools aceptan/guardan `projectPath`; inyectárselo a otras (búsquedas,
// borrados) sería un parámetro no declarado. El nombre llega con prefijo MCP.
const PROJECT_PATH_TOOLS = new Set([
  "saveMessage",
  "saveSessionSummary",
  "finalizeSession",
]);

const CONFIG_DIR =
  process.env.OPENCODE_CONFIG_DIR || join(homedir(), ".config", "opencode");

function extractText(parts) {
  return (parts ?? [])
    .filter((p) => p?.type === "text" && !p.synthetic && !p.ignored)
    .map((p) => p.text ?? "")
    .join("\n")
    .trim();
}

async function createConnection(mcpConfig) {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  let transport;

  if (mcpConfig.kind === "local") {
    const { StdioClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/stdio.js"
    );
    transport = new StdioClientTransport({
      command: mcpConfig.command,
      args: mcpConfig.args,
      env: mcpConfig.env,
      ...(mcpConfig.cwd ? { cwd: mcpConfig.cwd } : {}),
    });
  } else {
    const { StreamableHTTPClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/streamableHttp.js"
    );
    transport = new StreamableHTTPClientTransport(new URL(mcpConfig.url), {
      requestInit: {
        headers: mcpConfig.token
          ? { Authorization: "Bearer " + mcpConfig.token }
          : {},
      },
    });
  }

  const client = new Client({
    name: "opencode-conversation-memory",
    version: "1.0.0",
  });
  return { client, transport };
}

async function log(client, level, message, extra) {
  try {
    await client.app.log({
      body: { service: "conversation-memory", level, message, extra },
    });
  } catch (error) {
    console.error(`[conversation-memory] ${message}`, extra ?? "", error);
  }
}

export const ConversationMemory = async (
  { client, project, directory },
  options = {},
) => {
  const worktree = String(project?.worktree || "");
  const hasWorktree =
    resolveProjectIdentity("", worktree) && !/^[A-Za-z]:[\\/]*$/.test(worktree);
  const fallbackProjectPath = hasWorktree ? worktree : String(directory || "");
  const fallbackProjectName = resolveProjectIdentity(
    typeof project?.id === "string" ? project.id : "",
    fallbackProjectPath,
  );
  const mcpConfig = options.mcpConfig || findMcpConfig(directory || "");
  const cacheKey = createHash("sha256")
    .update(JSON.stringify([fallbackProjectName, mcpConfig]))
    .digest("hex")
    .slice(0, 24);
  const saveCache =
    options.cache ||
    createSaveCache(
      join(CONFIG_DIR, "conversation-memory-cache", cacheKey + ".json"),
    );
  const manager = createMcpClientManager(createConnection);
  const callSaveMessage =
    options.saveMessage ||
    (async (config, args) => {
      const mcp = await manager.getClient(config);
      return extractConfirmedMessageId(
        await mcp.callTool({ name: "saveMessage", arguments: args }),
      );
    });

  if (!fallbackProjectName || !mcpConfig) {
    console.error(
      `[conversation-memory] plugin desactivado: project=${fallbackProjectName ?? "desconocido"}, config=${mcpConfig ? "ok" : "no encontrada"}`,
    );
  } else {
    log(client, "info", "Plugin conversation-memory activado", {
      project: fallbackProjectName,
      endpoint:
        mcpConfig.kind === "local"
          ? mcpConfig.command + " " + mcpConfig.args.join(" ")
          : mcpConfig.url,
    });
  }

  // El proyecto se resuelve por identidad estable. OpenCode expone project.id y
  // session.projectID como identificadores del proyecto, mientras directory/worktree
  // son ubicaciones que pueden cambiar. Para sesiones de otros proyectos bajo el
  // mismo proceso, session.projectID tiene prioridad; el path queda como fallback
  // de compatibilidad cuando el ID no está disponible.
  //
  // Además del nombre corto (legible pero potencialmente colisionable), se
  // devuelve la ruta absoluta para poder detectar a posteriori dos repositorios
  // distintos que comparten basename.
  async function resolveProjectForSession(sessionID) {
    try {
      const res = await client.session.get({ path: { id: sessionID } });
      const sessionDirectory =
        typeof res?.data?.directory === "string" ? res.data.directory : "";
      const sessionProjectId = res?.data?.projectID ?? res?.data?.projectId;
      const resolved = resolveProjectIdentity(
        typeof sessionProjectId === "string" ? sessionProjectId : "",
        sessionDirectory || "",
      );
      if (resolved) {
        return {
          projectName: resolved,
          projectPath: sessionDirectory || fallbackProjectPath,
        };
      }
      if (sessionDirectory) {
        console.error(
          `[conversation-memory] directorio de sesión inválido como proyecto: ${JSON.stringify(sessionDirectory)}`,
        );
      }
    } catch (error) {
      console.error(
        `[conversation-memory] no se pudo resolver el proyecto de ${sessionID}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
    return {
      projectName: fallbackProjectName,
      projectPath: fallbackProjectPath,
    };
  }

  const pendingSaves = new Map();

  async function savePending(sessionID) {
    const pending = pendingSaves.get(sessionID);
    if (pending) return pending;
    const task = savePendingOnce(sessionID).finally(() =>
      pendingSaves.delete(sessionID),
    );
    pendingSaves.set(sessionID, task);
    return task;
  }

  async function savePendingOnce(sessionID) {
    if (!fallbackProjectName || !mcpConfig) return false;

    const { projectName, projectPath } =
      await resolveProjectForSession(sessionID);
    if (!projectName) return false;
    const pathArg = projectPath ? { projectPath } : {};

    try {
      const res = await client.session.messages({ path: { id: sessionID } });
      const messages = res?.data ?? [];

      const mcpIdByOpenCodeId = new Map();
      let currentAgent = "opencode";
      let savedCount = 0;

      for (const { info, parts } of messages) {
        if (!info?.id) continue;
        if (info.role === "assistant" && info.summary === true) continue;

        const text = extractText(parts);

        if (info.role === "user") {
          currentAgent = info.agent || currentAgent;
          if (!text) {
            mcpIdByOpenCodeId.set(info.id, "");
            continue;
          }
          if (saveCache.has(sessionID, info.id)) {
            mcpIdByOpenCodeId.set(
              info.id,
              saveCache.getMessageId(sessionID, info.id) ?? "",
            );
            continue;
          }
          const mcpId = await callSaveMessage(mcpConfig, {
            sessionId: sessionID,
            sourceMessageId: info.id,
            project: projectName,
            ...pathArg,
            role: "user",
            content: text,
            agentId: currentAgent,
          });
          saveCache.mark(sessionID, info.id, mcpId);
          mcpIdByOpenCodeId.set(info.id, mcpId);
          savedCount++;
        } else if (info.role === "assistant") {
          if (!text || saveCache.has(sessionID, info.id)) continue;
          const related = info.parentID
            ? mcpIdByOpenCodeId.get(info.parentID)
            : undefined;
          const mcpId = await callSaveMessage(mcpConfig, {
            sessionId: sessionID,
            sourceMessageId: info.id,
            project: projectName,
            ...pathArg,
            role: "assistant",
            content: text,
            // Cada mensaje assistant trae su propio agent: usar el del mensaje
            // user anterior como proxy dejaba atribuir al agente equivocado
            // cuando un turno cambiaba de agente (build -> plan, subagentes).
            agentId: info.agent || currentAgent,
            ...(related ? { relatedMessageId: related } : {}),
          });
          saveCache.mark(sessionID, info.id, mcpId);
          mcpIdByOpenCodeId.set(info.id, mcpId);
          savedCount++;
        }
      }

      if (savedCount > 0) {
        await saveCache.persist();
        log(
          client,
          "info",
          `Guardados ${savedCount} mensaje(s) de la sesión ${sessionID}`,
          {
            project: projectName,
          },
        );
        return true;
      }
      return false;
    } catch (error) {
      log(
        client,
        "error",
        "Error al guardar la sesión en conversation-memory",
        {
          sessionID,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return false;
    }
  }

  return {
    dispose: async () => {
      await Promise.all([...pendingSaves.values()]);
      await saveCache.persist();
      await manager.close();
    },
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        const sessionID = event.properties.sessionID;
        await savePending(sessionID);
      }
    },
    "tool.execute.before": async (input, output) => {
      if (!fallbackProjectName) return;
      if (!MCP_PREFIXES.some((prefix) => input.tool.startsWith(prefix))) return;
      const identity = input.sessionID
        ? await resolveProjectForSession(input.sessionID)
        : {
            projectName: fallbackProjectName,
            projectPath: fallbackProjectPath,
          };
      const args = output.args ?? {};
      let changed = false;
      if (!args.project) {
        args.project = identity.projectName;
        changed = true;
      }
      const toolName = input.tool.replace(
        /^conversation-memory(?:-local)?_/,
        "",
      );
      if (
        PROJECT_PATH_TOOLS.has(toolName) &&
        !args.projectPath &&
        identity.projectPath
      ) {
        args.projectPath = identity.projectPath;
        changed = true;
      }
      if (changed) output.args = args;
    },
  };
};

export default ConversationMemory;
