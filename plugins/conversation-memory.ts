import type { Plugin } from "@opencode-ai/plugin"
import { readFileSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

const MCP_PREFIXES = ["conversation-memory-local_", "conversation-memory_"]

const PROJECT_ALIASES: Record<string, string> = {
  "Authentication-system": "authentication-system",
  "Authentication-System": "authentication-system",
  "mi-portafolio": "portafolio",
  "conversation-memory-mcp": "conversation-memory-mcp",
}

const CONFIG_DIR = process.env.OPENCODE_CONFIG_DIR || join(homedir(), ".config", "opencode")
const CACHE_FILE = join(CONFIG_DIR, "conversation-memory-cache.json")

function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

function resolveProjectName(raw: string): string {
  return PROJECT_ALIASES[raw] ?? raw.toLowerCase()
}

function stripJsoncComments(src: string): string {
  let out = ""
  let inString = false
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (inString) {
      out += ch
      if (ch === "\\") {
        out += src[i + 1] ?? ""
        i += 2
        continue
      }
      if (ch === '"') inString = false
      i++
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      i++
      continue
    }
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++
      continue
    }
    if (ch === "/" && src[i + 1] === "*") {
      i += 2
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++
      i += 2
      continue
    }
    out += ch
    i++
  }
  return out.replace(/,\s*([}\]])/g, "$1")
}

function readJsonc(file: string): any {
  try {
    return JSON.parse(stripJsoncComments(readFileSync(file, "utf8")))
  } catch {
    return null
  }
}

type McpLocalConfig = { kind: "local"; command: string; args: string[]; env: Record<string, string>; cwd?: string }
type McpRemoteConfig = { kind: "remote"; url: string; token: string }
type McpResolved = McpLocalConfig | McpRemoteConfig

function resolveEnvTemplate(value: string): string {
  return value.replace(/\{env:([A-Z0-9_]+)\}/g, (_m, name: string) => process.env[name] ?? "")
}

function findMcpConfig(directory: string): McpResolved | null {
  const envUrl = process.env.CONVERSATION_MEMORY_URL
  const envToken = process.env.CONVERSATION_MEMORY_TOKEN
  if (envUrl && envToken) return { kind: "remote", url: envUrl, token: envToken }

  const candidates = [
    join(CONFIG_DIR, "opencode.jsonc"),
    join(CONFIG_DIR, "opencode.json"),
    join(directory, "opencode.json"),
    join(directory, "opencode.jsonc"),
    join(directory, ".opencode", "opencode.json"),
  ]
  for (const file of candidates) {
    const cfg = readJsonc(file)
    const mcp = cfg?.mcp
    if (!mcp) continue

    const local = mcp["conversation-memory-local"]
    if (local?.command) {
      const commandArr = Array.isArray(local.command)
        ? local.command
        : [local.command, ...(local.args ?? [])]
      if (commandArr.length === 0) continue
      const env: Record<string, string> = {}
      for (const [key, raw] of Object.entries(local.environment ?? {})) {
        const resolved = resolveEnvTemplate(String(raw))
        if (resolved) env[key] = resolved
      }
      return {
        kind: "local",
        command: commandArr[0],
        args: commandArr.slice(1),
        env,
        ...(local.cwd ? { cwd: local.cwd } : {}),
      }
    }

    const remote = mcp["conversation-memory"]
    if (!remote?.url) continue
    const auth = remote.headers?.Authorization ?? remote.headers?.authorization
    const token = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : ""
    return { kind: "remote", url: remote.url, token }
  }
  return null
}

function loadCache(): Record<string, Record<string, boolean>> {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf8"))
  } catch {
    return {}
  }
}

const cache: Record<string, Record<string, boolean>> = loadCache()

function isSaved(sessionID: string, messageID: string): boolean {
  return Boolean(cache[sessionID]?.[messageID])
}

function markSaved(sessionID: string, messageID: string): void {
  cache[sessionID] ??= {}
  cache[sessionID][messageID] = true
}

async function persistCache(): Promise<void> {
  try {
    await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2))
  } catch (error) {
    console.error("[conversation-memory] no se pudo persistir la caché de guardado:", error)
  }
}

function extractText(parts: any[]): string {
  return (parts ?? [])
    .filter((p) => p?.type === "text" && !p.synthetic && !p.ignored)
    .map((p) => p.text ?? "")
    .join("\n")
    .trim()
}

let mcpClient: any = null

async function getMcpClient(mcpConfig: McpResolved): Promise<any> {
  if (mcpClient) return mcpClient
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
  let transport: any

  if (mcpConfig.kind === "local") {
    const { StdioClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/stdio.js"
    )
    transport = new StdioClientTransport({
      command: mcpConfig.command,
      args: mcpConfig.args,
      env: mcpConfig.env,
      ...(mcpConfig.cwd ? { cwd: mcpConfig.cwd } : {}),
    })
  } else {
    const { StreamableHTTPClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/streamableHttp.js"
    )
    transport = new StreamableHTTPClientTransport(new URL(mcpConfig.url), {
      requestInit: {
        headers: mcpConfig.token ? { Authorization: `Bearer ${mcpConfig.token}` } : {},
      },
    })
  }

  const client = new Client({ name: "opencode-conversation-memory", version: "1.0.0" })
  await client.connect(transport)
  mcpClient = client
  return client
}

async function callSaveMessage(
  mcpConfig: McpResolved,
  args: Record<string, unknown>
): Promise<string | undefined> {
  const client = await getMcpClient(mcpConfig)
  const result = await client.callTool({ name: "saveMessage", arguments: args })
  const text = (result?.content ?? []).map((c: any) => c?.text ?? "").join("")
  const match = text.match(/ID:\s*(\S+)/)
  return match?.[1]
}

async function log(client: any, level: string, message: string, extra?: unknown): Promise<void> {
  try {
    await client.app.log({
      body: { service: "conversation-memory", level, message, extra },
    })
  } catch (error) {
    console.error(`[conversation-memory] ${message}`, extra ?? "", error)
  }
}

export const ConversationMemory: Plugin = async ({ client, project, directory }) => {
  const projectName = resolveProjectName(
    baseName(project?.worktree || directory || project?.id || "")
  )
  const mcpConfig = findMcpConfig(directory || "")

  if (!projectName || !mcpConfig) {
    console.error(
      `[conversation-memory] plugin desactivado: project=${projectName ?? "desconocido"}, config=${mcpConfig ? "ok" : "no encontrada"}`
    )
  } else {
    log(client, "info", "Plugin conversation-memory activado", {
      project: projectName,
      endpoint:
        mcpConfig.kind === "local"
          ? mcpConfig.command + " " + mcpConfig.args.join(" ")
          : mcpConfig.url,
    })
  }

  async function savePending(sessionID: string): Promise<void> {
    if (!projectName || !mcpConfig) return

    try {
      const res: any = await client.session.messages({ path: { id: sessionID } })
      const messages: Array<{ info: any; parts: any[] }> = res?.data ?? []

      const mcpIdByOpenCodeId = new Map<string, string>()
      let currentAgent = "opencode"
      let savedCount = 0

      for (const { info, parts } of messages) {
        if (!info?.id) continue
        if (info.role === "assistant" && info.summary === true) continue

        const text = extractText(parts)

        if (info.role === "user") {
          currentAgent = info.agent || currentAgent
          if (!text) {
            mcpIdByOpenCodeId.set(info.id, "")
            continue
          }
          if (isSaved(sessionID, info.id)) {
            mcpIdByOpenCodeId.set(info.id, "")
            continue
          }
          const mcpId = await callSaveMessage(mcpConfig!, {
            sessionId: sessionID,
            project: projectName,
            role: "user",
            content: text,
            agentId: currentAgent,
          })
          markSaved(sessionID, info.id)
          mcpIdByOpenCodeId.set(info.id, mcpId ?? "")
          if (mcpId) savedCount++
        } else if (info.role === "assistant") {
          if (!text || isSaved(sessionID, info.id)) continue
          const related = info.parentID ? mcpIdByOpenCodeId.get(info.parentID) : undefined
          await callSaveMessage(mcpConfig!, {
            sessionId: sessionID,
            project: projectName,
            role: "assistant",
            content: text,
            agentId: currentAgent,
            ...(related ? { relatedMessageId: related } : {}),
          })
          markSaved(sessionID, info.id)
          savedCount++
        }
      }

      if (savedCount > 0) {
        await persistCache()
        log(client, "info", `Guardados ${savedCount} mensaje(s) de la sesión ${sessionID}`, {
          project: projectName,
        })
      }
    } catch (error) {
      log(client, "error", "Error al guardar la sesión en conversation-memory", {
        sessionID,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        await savePending(event.properties.sessionID)
      }
    },
    "tool.execute.before": async (input, output) => {
      if (!projectName) return
      if (!MCP_PREFIXES.some((prefix) => input.tool.startsWith(prefix))) return
      const args = output.args ?? {}
      if (!args.project) {
        args.project = projectName
        output.args = args
      }
    },
  }
}

export default ConversationMemory