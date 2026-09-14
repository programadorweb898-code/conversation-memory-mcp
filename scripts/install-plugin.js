#!/usr/bin/env node
const { spawnSync } = require("node:child_process")
const { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } = require("node:fs")
const { homedir } = require("node:os")
const { join, dirname, resolve } = require("node:path")

const REPO_ROOT = resolve(dirname(__dirname))
const PLUGIN_SOURCE = join(REPO_ROOT, "plugins", "conversation-memory.ts")
const CONFIG_DIR = process.env.OPENCODE_CONFIG_DIR || join(homedir(), ".config", "opencode")
const PLUGINS_DIR = join(CONFIG_DIR, "plugins")
const PLUGIN_DEST = join(PLUGINS_DIR, "conversation-memory.ts")
const CONFIG_FILE = join(CONFIG_DIR, "opencode.jsonc")
const SDK_PKG = "@modelcontextprotocol/sdk"

function toPosix(p) {
  return p.replace(/\\/g, "/")
}

function log(msg) {
  console.log(`[install-plugin] ${msg}`)
}

function warn(msg) {
  console.warn(`[install-plugin] ATENCION: ${msg}`)
}

function run(command, args, cwd) {
  const res = spawnSync(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32" })
  return res.status === 0
}

function stripJsoncComments(src) {
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

function skipWsAndComments(src, i) {
  while (i < src.length) {
    const ch = src[i]
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
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
    break
  }
  return i
}

function findMatchingBrace(src, openIdx) {
  let depth = 0
  let inString = false
  let inLine = false
  let inBlock = false
  let i = openIdx
  while (i < src.length) {
    const ch = src[i]
    if (inString) {
      if (ch === "\\") {
        i += 2
        continue
      }
      if (ch === '"') inString = false
      i++
      continue
    }
    if (inLine) {
      if (ch === "\n") inLine = false
      i++
      continue
    }
    if (inBlock) {
      if (ch === "*" && src[i + 1] === "/") {
        inBlock = false
        i += 2
        continue
      }
      i++
      continue
    }
    if (ch === "/" && src[i + 1] === "/") {
      inLine = true
      i += 2
      continue
    }
    if (ch === "/" && src[i + 1] === "*") {
      inBlock = true
      i += 2
      continue
    }
    if (ch === '"') {
      inString = true
      i++
      continue
    }
    if (ch === "{") {
      depth++
      i++
      continue
    }
    if (ch === "}") {
      if (depth === 1) return i
      depth--
      i++
      continue
    }
    i++
  }
  return -1
}

function findMcpValueOpen(src) {
  let depth = 0
  let expectsKey = true
  let inString = false
  let inLine = false
  let inBlock = false
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (inString) {
      if (ch === "\\") {
        i += 2
        continue
      }
      if (ch === '"') inString = false
      i++
      continue
    }
    if (inLine) {
      if (ch === "\n") inLine = false
      i++
      continue
    }
    if (inBlock) {
      if (ch === "*" && src[i + 1] === "/") {
        inBlock = false
        i += 2
        continue
      }
      i++
      continue
    }
    if (ch === "/" && src[i + 1] === "/") {
      inLine = true
      i += 2
      continue
    }
    if (ch === "/" && src[i + 1] === "*") {
      inBlock = true
      i += 2
      continue
    }
    if (ch === '"') {
      if (depth === 1 && expectsKey) {
        let j = i + 1
        let escaped = false
        while (j < src.length) {
          if (escaped) escaped = false
          else if (src[j] === "\\") escaped = true
          else if (src[j] === '"') break
          j++
        }
        const key = src.slice(i, j + 1)
        if (key === '"mcp"') {
          let k = j + 1
          while (k < src.length && src[k] !== ":") k++
          const openIdx = skipWsAndComments(src, k + 1)
          if (src[openIdx] === "{") return openIdx
        }
        expectsKey = false
        i = j + 1
        continue
      }
      inString = true
      i++
      continue
    }
    if (ch === "{") {
      depth++
      if (depth === 1) expectsKey = true
      i++
      continue
    }
    if (ch === "}") {
      depth--
      expectsKey = false
      i++
      continue
    }
    if (ch === ",") {
      if (depth === 1) expectsKey = true
      i++
      continue
    }
    i++
  }
  return -1
}

function lineIndentOf(src, idx) {
  let lineStart = src.lastIndexOf("\n", idx)
  if (lineStart === -1) lineStart = 0
  else lineStart += 1
  const line = src.slice(lineStart, idx)
  const match = line.match(/^[ \t]*/)
  return match ? match[0] : ""
}

function buildMcpEntry(posixRepoRoot) {
  return [
    `"conversation-memory-local": {`,
    `  "type": "local",`,
    `  "command": ["node", "${posixRepoRoot}/src/stdio.js"],`,
    `  "cwd": "${posixRepoRoot}",`,
    `  "enabled": true`,
    `}`,
  ].join("\n")
}

function configureOpencodeJsonc() {
  const posixRepoRoot = toPosix(REPO_ROOT)
  const entry = buildMcpEntry(posixRepoRoot)

  if (!existsSync(CONFIG_FILE)) {
    const lines = entry.split("\n")
    writeFileSync(
      CONFIG_FILE,
      `{\n  "mcp": {\n  ${lines.join("\n  ")}\n  }\n}\n`,
      "utf8"
    )
    log(`opencode.jsonc no existía; creado con el bloque MCP local`)
    return
  }

  const src = readFileSync(CONFIG_FILE, "utf8")
  const openIdx = findMcpValueOpen(src)
  if (openIdx === -1) {
    warn("no se encontró un objeto \"mcp\" raíz en opencode.jsonc; no se modificó. Agregalo manualmente:")
    console.log(entry)
    return
  }

  const closeIdx = findMatchingBrace(src, openIdx)
  const insideRaw = src.slice(openIdx + 1, closeIdx)
  if (insideRaw.includes('"conversation-memory-local"')) {
    if (insideRaw.includes("environment")) {
      warn(
        'el bloque conversation-memory-local ya existe pero contiene "environment" con DATABASE_URL; ' +
          "quitá esa sección para que el server lea el .env del repo"
      )
    } else {
      log("el bloque conversation-memory-local ya está configurado con cwd; sin cambios")
    }
    return
  }

  const strippedInside = stripJsoncComments(insideRaw).trim()
  const indent = lineIndentOf(src, closeIdx)
  const childIndent = indent + "  "
  const needsComma = strippedInside.length > 0 && !strippedInside.endsWith(",")

  let lastNonWs = closeIdx
  while (lastNonWs > openIdx && /\s/.test(src[lastNonWs - 1])) lastNonWs--
  const entryText = entry.split("\n").join(`\n${childIndent}`)
  const block = `${needsComma ? "," : ""}\n${childIndent}${entryText}\n${indent}`
  const updated = src.slice(0, lastNonWs) + block + src.slice(lastNonWs)

  try {
    JSON.parse(stripJsoncComments(updated))
  } catch (err) {
    warn(`la modificación de opencode.jsonc no quedó como JSON válido (${err.message}); el archivo no se tocó`)
    return
  }
  writeFileSync(CONFIG_FILE, updated, "utf8")
  log(`bloque conversation-memory-local agregado a ${CONFIG_FILE}`)
}

function ensureRepoDeps() {
  log("instalando dependencias del repositorio (npm install)...")
  if (!run("npm", ["install"], REPO_ROOT)) {
    warn("npm install del repo falló; verificá node/npm")
  }
}

function ensurePluginCopy() {
  if (!existsSync(PLUGIN_SOURCE)) {
    warn(`no se encontró ${PLUGIN_SOURCE}`)
    return false
  }
  mkdirSync(PLUGINS_DIR, { recursive: true })
  copyFileSync(PLUGIN_SOURCE, PLUGIN_DEST)
  log(`plugin copiado a ${PLUGIN_DEST}`)
  return true
}

function ensurePluginSdk() {
  const sdkDir = join(CONFIG_DIR, "node_modules", "@modelcontextprotocol", "sdk")
  if (existsSync(sdkDir)) {
    log(`@modelcontextprotocol/sdk ya instalado en ${CONFIG_DIR}`)
    return
  }
  const pkgFile = join(CONFIG_DIR, "package.json")
  if (!existsSync(pkgFile)) {
    writeFileSync(pkgFile, "{}", "utf8")
    log(`creado package.json en ${CONFIG_DIR}`)
  }
  log("instalando @modelcontextprotocol/sdk en el directorio de config de opencode...")
  if (!run("npm", ["install", "--no-save", SDK_PKG], CONFIG_DIR)) {
    warn("no se pudo instalar el SDK en el directorio de config de opencode")
  }
}

function ensureEnvFile() {
  const envFile = join(REPO_ROOT, ".env")
  const envExample = join(REPO_ROOT, ".env.example")
  if (!existsSync(envFile)) {
    if (existsSync(envExample)) {
      copyFileSync(envExample, envFile)
      warn(
        `se creó .env a partir de .env.example. Pegá tu cadena de conexión de Neon en .env (requiere reiniciar el MCP)`
      )
    } else {
      warn("no se encontró .env ni .env.example; creá .env con DATABASE_URL")
    }
    return
  }
  const content = readFileSync(envFile, "utf8")
  if (!/^DATABASE_URL\s*=\s*\S+/m.test(content)) {
    warn("DATABASE_URL no está definido en el .env del repo; sin él el server no arranca")
  } else {
    log(`.env del repo ya tiene DATABASE_URL definida`)
  }
}

log(`repo:     ${REPO_ROOT}`)
log(`config:   ${CONFIG_FILE}`)
log("")

ensureRepoDeps()
ensurePluginCopy()
ensurePluginSdk()
configureOpencodeJsonc()
ensureEnvFile()

log("")
log("Instalación completa. Pasos siguientes:")
log("  1. Reiniciá opencode (y VS Code si usás Copilot).")
log("  2. Verificá que el plugin cargue en el log: [conversation-memory] Plugin conversation-memory activado")
log("  3. El project se resuelve solo desde el directorio de trabajo.")