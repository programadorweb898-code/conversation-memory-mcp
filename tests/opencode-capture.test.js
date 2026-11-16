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
      event: { subscribe: async function* ({ signal, types }) {
        assert.ok(types.includes("session.execution.succeeded"));
        subscribed = signal;
        await new Promise(resolve => { resolveEvent = resolve; });
        yield { type: "session.execution.succeeded", data: { sessionID: "session-v2" } };
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
  for (const type of ["session.execution.succeeded", "session.execution.failed", "session.execution.interrupted"]) {
    it(`captures a V2 ${type} without receiving session.idle and deduplicates terminal events`, async () => {
      const { setupConversationMemory } = await import("../plugins/opencode-v2.mjs");
      const saves = []; let consumed;
      const done = new Promise(resolve => { consumed = resolve; });
      const ctx = {
        location: { directory: "/repos/project" },
        session: {
          get: async () => ({ location: { directory: "/repos/project" } }),
          context: async () => [
            { id: "u", type: "user", text: "A real lifecycle question" },
            { id: "a", type: "assistant", content: [{ type: "text", text: "Visible terminal response" }] },
          ],
        },
        tool: { hook: async () => ({ dispose: async () => {} }) },
        event: { subscribe: async function* ({ types }) {
          assert.ok(types.includes(type));
          yield { id: "event-1", type, data: { sessionID: "s" } };
          yield { id: "event-2", type, data: { sessionID: "s" } };
          consumed();
        } },
      };
      const cleanup = await setupConversationMemory(ctx, options(saves));
      await done; await cleanup();
      assert.equal(saves.length, 2);
      assert.equal(saves[1].relatedMessageId, "mcp-u");
    });
  }
  it("rescans when a second turn completes while the previous save is still in flight", async () => {
    const { default: plugin } = await import("../plugins/opencode-v1.mjs");
    let release, started;
    const gate = new Promise(resolve => { release = resolve; });
    const saving = new Promise(resolve => { started = resolve; });
    const saves = [], opts = options(saves), originalSave = opts.saveMessage;
    opts.saveMessage = async (config, args) => {
      if (args.sourceMessageId === "u1") { started(); await gate; }
      return originalSave(config, args);
    };
    const turn = n => [
      { info: { id: `u${n}`, role: "user" }, parts: [{ type: "text", text: `Question ${n}` }] },
      { info: { id: `a${n}`, role: "assistant", parentID: `u${n}` }, parts: [{ type: "text", text: `Answer ${n}` }] },
    ];
    let messages = turn(1);
    const hooks = await plugin({ directory: "/repos/project", project: {}, client: {
      app: { log: async () => {} }, session: { get: async () => ({ data: { directory: "/repos/project" } }), messages: async () => ({ data: messages }) },
    } }, opts);
    const event = { event: { type: "session.idle", properties: { sessionID: "s" } } };
    const first = hooks.event(event); await saving;
    messages = [...messages, ...turn(2)];
    const second = hooks.event(event); release(); await Promise.all([first, second]);
    assert.deepEqual(saves.map(m => m.sourceMessageId), ["u1", "a1", "u2", "a2"]);
    assert.equal(saves[3].relatedMessageId, "mcp-u2"); await hooks.dispose();
  });
  it("does not send another project's V2 events to this project's MCP connection", async () => {
    const { setupConversationMemory } = await import("../plugins/opencode-v2.mjs");
    const saves = []; let end;
    const done = new Promise(resolve => { end = resolve; });
    const cleanup = await setupConversationMemory({ location: { directory: "/repos/project-a" }, session: {
      get: async () => { throw new Error("Must not read another project"); },
      context: async () => { throw new Error("Must not read another project"); },
    }, tool: { hook: async () => ({ dispose: async () => {} }) }, event: { subscribe: async function* () {
      yield { type: "session.execution.succeeded", location: { directory: "/repos/project-b" }, data: { sessionID: "other" } }; end();
    } } }, options(saves));
    await done; await cleanup(); assert.equal(saves.length, 0);
  });
});
