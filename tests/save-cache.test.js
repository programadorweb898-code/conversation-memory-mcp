const assert = require("node:assert/strict")
const { mkdtemp, readFile, rm } = require("node:fs/promises")
const { tmpdir } = require("node:os")
const { join } = require("node:path")
const { createSaveCache } = require("../plugins/save-cache.js")

describe("plugin save cache", () => {
  let dir

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "conversation-memory-cache-"))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it("deduplicates messages and keeps the cache bounded", async () => {
    const file = join(dir, "cache.json")
    const cache = createSaveCache(file, { maxEntries: 2 })

    cache.mark("session-1", "message-1")
    cache.mark("session-1", "message-2")
    cache.mark("session-1", "message-3")

    assert.equal(cache.size(), 2)
    assert.equal(cache.has("session-1", "message-1"), false)
    assert.equal(cache.has("session-1", "message-2"), true)
    assert.equal(cache.has("session-1", "message-3"), true)

    cache.mark("session-1", "message-2")
    assert.equal(cache.size(), 2)
  })

  it("loads the existing cache and persists it atomically", async () => {
    const file = join(dir, "cache.json")
    const cache = createSaveCache(file, { maxEntries: 10 })
    cache.mark("session-1", "message-1")
    await cache.persist()

    const persisted = JSON.parse(await readFile(file, "utf8"))
    assert.deepEqual(persisted, {
      "session-1": {
        "message-1": true,
      },
    })

    const restored = createSaveCache(file, { maxEntries: 10 })
    assert.equal(restored.has("session-1", "message-1"), true)
  })

  it("serializes concurrent persistence calls", async () => {
    const file = join(dir, "cache.json")
    const cache = createSaveCache(file, { maxEntries: 10 })

    cache.mark("session-1", "message-1")
    const first = cache.persist()
    cache.mark("session-1", "message-2")
    const second = cache.persist()

    await Promise.all([first, second])

    const persisted = JSON.parse(await readFile(file, "utf8"))
    assert.deepEqual(persisted["session-1"], {
      "message-1": true,
      "message-2": true,
    })
  })
})
