const assert = require("node:assert/strict");
const { createSaveCache } = require("../plugins/save-cache");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

function options(saves) {
  return { mcpConfig: { kind: "local", command: "unused", args: [], env: {} },
    cache: createSaveCache(join(mkdtempSync(join(tmpdir(), "cm-capture-")), "cache.json")),
    saveMessage: async (_config, args) => { saves.push(args); return `mcp-${args.sourceMessageId}`; } };
}
describe("OpenCode capture adapters", () => {
  it("captures completed V1 turns exactly once and keeps the user/assistant relation", async () => {
    const { default: plugin } = await import("../plugins/opencode-v1.mjs");
    const saves = [];
    const client = { app: { log: async () => {} }, session: {
      get: async () => ({ data: { directory: "/repos/project", projectID: "project" } }),
      messages: async () => ({ data: [
        { info: { id: "user-1", role: "user" }, parts: [{ type: "text", text: "Remember this project decision" }] },
        { info: { id: "assistant-1", role: "assistant", parentID: "user-1", agent: "build" }, parts: [{ type: "text", text: "I will save the decision" }] },
      ] }),
    } };
    const hooks = await plugin({ client, directory: "/repos/project", project: { id: "project" } }, options(saves));
    const event = { event: { type: "session.idle", properties: { sessionID: "session-1" } } };
    await Promise.all([hooks.event(event), hooks.event(event)]); await hooks.event(event);
    assert.equal(saves.length, 2); assert.equal(saves[1].relatedMessageId, "mcp-user-1");
    assert.equal(saves[1].project, "project"); assert.equal(saves[1].agentId, "build");
    const output = { args: {} };
    await hooks["tool.execute.before"]({ tool: "conversation-memory_saveMessage", sessionID: "session-1" }, output);
    assert.equal(output.args.project, "project"); assert.equal(output.args.projectPath, "/repos/project");
    await hooks.dispose();
  });
  it("uses the actual directory for OpenCode global projects outside Git", async () => {
    const { default: plugin } = await import("../plugins/opencode-v1.mjs");
    for (const worktree of ["/", String.fromCharCode(67, 58, 92)]) {
      const hooks = await plugin({ directory: "/repos/actual-project", project: { id: "global", worktree },
        client: { app: { log: async () => {} } } }, options([]));
      const output = { args: {} };
      await hooks["tool.execute.before"]({ tool: "conversation-memory_saveMessage" }, output);
      assert.equal(output.args.project, "actual-project");
      assert.equal(output.args.projectPath, "/repos/actual-project");
      await hooks.dispose();
    }
  });
  it("maps V2 context and event.data, excludes compaction/reasoning and disposes on unload", async () => {
    const { setupConversationMemory, default: definition } = await import("../plugins/opencode-v2.mjs");
    assert.equal(definition.id, "conversation-memory");
    const saves = [], registrations = []; let resolveEvent; let completed; let subscribed;
    const consumed = new Promise(resolve => { completed = resolve; });
    const ctx = { location: { directory: "/repos/project", project: { id: "project", canonical: "/repos/project" } },
      session: {
        get: async input => { assert.equal(input.sessionID, "session-v2"); return { location: { directory: "/repos/project" }, projectID: "project" }; },
        context: async () => [
          { id: "switch", type: "agent-switched", agent: "plan" },
          { id: "u-v2", type: "user", text: "A meaningful user message" },
          { id: "compaction", type: "compaction", summary: "Do not store this" },
          { id: "a-v2", type: "assistant", agent: "build", content: [{ type: "reasoning", text: "private reasoning" }, { type: "text", text: "A visible response" }] },
        ],
      },
      tool: { hook: async (name, callback) => { registrations.push({ name, callback }); return { dispose: async () => { registrations.push("disposed"); } }; } },
      event: { subscribe: async function* ({ signal }) {
        subscribed = signal;
        await new Promise(resolve => { resolveEvent = resolve; });
        yield { type: "session.idle", data: { sessionID: "session-v2" } };
        completed();
        await new Promise(resolve => { if (signal.aborted) resolve(); else signal.addEventListener("abort", resolve, { once: true }); });
      } },
    };
    const cleanup = await setupConversationMemory(ctx, options(saves));
    resolveEvent(); await consumed;
    assert.equal(saves.length, 2); assert.equal(saves[0].agentId, "plan");
    assert.equal(saves[1].content, "A visible response"); assert.equal(saves[1].relatedMessageId, "mcp-u-v2");
    const toolEvent = { tool: "conversation-memory_searchMessages", sessionID: "session-v2", input: {} };
    await registrations[0].callback(toolEvent);
    assert.equal(toolEvent.input.project, "project"); assert.equal(toolEvent.input.projectPath, undefined);
    await cleanup(); assert.equal(subscribed.aborted, true); assert.ok(registrations.includes("disposed"));
  });
});
