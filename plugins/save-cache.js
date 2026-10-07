const { readFileSync } = require("node:fs")
const { mkdir, rename, writeFile } = require("node:fs/promises")
const { dirname, join } = require("node:path")

const DEFAULT_MAX_ENTRIES = 10000

function normalizeEntries(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return []
  const entries = []
  for (const [sessionID, messages] of Object.entries(raw)) {
    if (!messages || typeof messages !== "object" || Array.isArray(messages)) continue
    for (const [messageID, value] of Object.entries(messages)) {
      if (value) entries.push([`${sessionID}\u0000${messageID}`, true])
    }
  }
  return entries
}

function loadCache(file, maxEntries = DEFAULT_MAX_ENTRIES) {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"))
    const entries = normalizeEntries(raw)
    const start = Math.max(0, entries.length - maxEntries)
    return new Map(entries.slice(start))
  } catch {
    return new Map()
  }
}

function createSaveCache(file, options = {}) {
  const maxEntries = Number.isInteger(options.maxEntries) && options.maxEntries > 0
    ? options.maxEntries
    : DEFAULT_MAX_ENTRIES

  const cache = loadCache(file, maxEntries)
  let persistChain = Promise.resolve()

  function key(sessionID, messageID) {
    return `${sessionID}\u0000${messageID}`
  }

  function has(sessionID, messageID) {
    return cache.has(key(sessionID, messageID))
  }

  function mark(sessionID, messageID) {
    const cacheKey = key(sessionID, messageID)
    if (cache.has(cacheKey)) cache.delete(cacheKey)
    cache.set(cacheKey, true)

    while (cache.size > maxEntries) {
      cache.delete(cache.keys().next().value)
    }
  }

  function snapshot() {
    const result = {}
    for (const cacheKey of cache.keys()) {
      const separator = cacheKey.indexOf("\u0000")
      if (separator === -1) continue
      const sessionID = cacheKey.slice(0, separator)
      const messageID = cacheKey.slice(separator + 1)
      result[sessionID] ??= {}
      result[sessionID][messageID] = true
    }
    return result
  }

  function persist() {
    const data = JSON.stringify(snapshot(), null, 2)
    const tempFile = join(dirname(file), `.${file.split(/[\\/]/).pop()}.tmp`)
    persistChain = persistChain
      .catch(() => {})
      .then(async () => {
        await mkdir(dirname(file), { recursive: true })
        await writeFile(tempFile, data, "utf8")
        await rename(tempFile, file)
      })
    return persistChain
  }

  return {
    has,
    mark,
    persist,
    size: () => cache.size,
    maxEntries,
  }
}

module.exports = { createSaveCache, loadCache, DEFAULT_MAX_ENTRIES }
