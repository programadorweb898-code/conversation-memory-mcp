const assert = require("node:assert/strict");
const { mkdtempSync, writeFileSync, mkdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { db, cleanupMessages } = require("./test-helper");

describe("packaged native capture command", function () {
  this.timeout(60000);
  for (const agent of ["claude", "gemini-cli", "cursor"]) {
    it(`persists and links ${agent} messages through the CLI without duplicate rows`, async () => {
      const cwd = mkdtempSync(join(tmpdir(), "cm-hook-db-"));
      const session = randomUUID();
      const cli = resolve(__dirname, "../src/cli.js");
      const input = { session_id: session, cwd, hook_event_name: agent === "claude" ? "Stop" : "AfterAgent" };
      if (agent === "claude") {
        input.transcript_path = join(cwd, "transcript.jsonl");
        writeFileSync(input.transcript_path, [
          { uuid: "user", message: { role: "user", content: "A meaningful CLI user question" } },
          { uuid: "assistant", message: { role: "assistant", content: [{ type: "text", text: "A meaningful CLI answer" }] } },
        ].map(row => JSON.stringify(row)).join("\n"));
      } else if (agent === "gemini-cli") {
        input.transcript_path = join(cwd, "transcript.json");
        input.prompt_response = "A meaningful CLI answer";
        writeFileSync(input.transcript_path, JSON.stringify({ messages: [
          { id: "user", type: "user", content: "A meaningful CLI user question" },
          { id: "assistant", type: "gemini", content: "A meaningful CLI answer" },
        ] }));
      } else {
        input.conversation_id = session; input.generation_id = "turn";
        input.hook_event_name = "beforeSubmitPrompt"; input.prompt = "A meaningful CLI user question";
      }
      function invoke(payload) {
        const child = spawnSync(process.execPath, [cli, "capture", "--agent", agent], {
          cwd, encoding: "utf8", input: JSON.stringify(payload), timeout: 30000, windowsHide: true,
          env: { ...process.env, ENABLE_EMBEDDINGS: "false", APPDATA: cwd, XDG_CONFIG_HOME: cwd },
        });
        assert.equal(child.status, 0, child.stderr); assert.equal(child.error, undefined);
        assert.equal(child.stderr.includes("No se pudo capturar"), false, child.stderr);
        return JSON.parse(child.stdout);
      }
      try {
        invoke(input);
        if (agent === "cursor") {
          input.hook_event_name = "afterAgentResponse"; input.text = "A meaningful CLI answer";
        }
        invoke(input); invoke(input);
        const rows = await db.allAsync("SELECT id, role, content, related_message_id FROM conversations WHERE session_id = $1 ORDER BY sequence_id", [`${agent}:${session}`]);
        assert.equal(rows.length, 2); assert.equal(rows[0].role, "user"); assert.equal(rows[1].role, "assistant");
        assert.equal(rows[1].related_message_id, rows[0].id);
      } finally { await cleanupMessages({ sessionIds: [`${agent}:${session}`] }); }
    });
  }
});

describe("extended capture CLI database integration", function () {
  this.timeout(90000);
  for (const agent of ["codex", "trae", "qwen-code", "github-copilot", "windsurf", "kimi", "hermes", "pi", "kilocode", "openclaw"]) {
    it(`stores ${agent} native payloads with confirmed links and repeat-event deduplication`, async () => {
      const cwd = mkdtempSync(join(tmpdir(), "cm-extended-db-")), session = randomUUID();
      const input = { session_id: session, cwd }, file = join(cwd, "transcript.jsonl");
      if (["codex", "trae"].includes(agent)) Object.assign(input, { turn_id: "turn", hook_event_name: "UserPromptSubmit", prompt: "Meaningful integration question" });
      else if (agent === "hermes") input.extra = { turn_id: "turn", user_message: "Meaningful integration question", assistant_response: "Meaningful integration answer" };
      else if (["pi", "kilocode", "openclaw"].includes(agent)) input.messages = [{ id: "u", role: "user", content: "Meaningful integration question" }, { id: "a", role: "assistant", content: "Meaningful integration answer" }];
      else {
        const records = agent === "qwen-code" ? [
          { uuid: "u", type: "user", message: { role: "user", parts: [{ text: "Meaningful integration question" }] } },
          { uuid: "a", type: "assistant", message: { role: "model", parts: [{ text: "Meaningful integration answer" }] } },
        ] : agent === "github-copilot" ? [
          { id: "u", type: "user.message", data: { content: "Meaningful integration question" } },
          { id: "a", type: "assistant.message", data: { content: "Meaningful integration answer" } },
        ] : agent === "windsurf" ? [
          { status: "done", type: "user_input", user_input: { user_response: "Meaningful integration question" } },
          { status: "done", type: "planner_response", planner_response: { response: "Meaningful integration answer" } },
        ] : [{ role: "user", content: "Meaningful integration question" }, { role: "assistant", content: "Meaningful integration answer" }];
        if (agent === "kimi") {
          const directory = join(cwd, "sessions", "project-hash", session); mkdirSync(directory, { recursive: true });
          writeFileSync(join(directory, "context.jsonl"), records.map(r => JSON.stringify(r)).join("\n"));
        } else {
          writeFileSync(file, records.map(r => JSON.stringify(r)).join("\n"));
          input.transcript_path = file;
          if (agent === "windsurf") { delete input.cwd; delete input.transcript_path; input.trajectory_id = session; input.tool_info = { transcript_path: file }; }
        }
      }
      const invoke = payload => {
        const child = spawnSync(process.execPath, [resolve(__dirname, "../src/cli.js"), "capture", "--agent", agent], {
          cwd, encoding: "utf8", input: JSON.stringify(payload), timeout: 30000, windowsHide: true,
          env: { ...process.env, ENABLE_EMBEDDINGS: "false", APPDATA: cwd, XDG_CONFIG_HOME: cwd, KIMI_SHARE_DIR: cwd },
        });
        assert.equal(child.error, undefined); assert.equal(child.status, 0, child.stderr);
        assert.equal(child.stderr.includes("No se pudo capturar"), false, child.stderr); assert.deepEqual(JSON.parse(child.stdout), {});
      };
      try {
        invoke(input);
        if (["codex", "trae"].includes(agent)) Object.assign(input, { hook_event_name: "Stop", last_assistant_message: "Meaningful integration answer" });
        invoke(input); invoke(input);
        const rows = await db.allAsync("SELECT id, role, content, related_message_id FROM conversations WHERE session_id = $1 ORDER BY sequence_id", [`${agent}:${session}`]);
        assert.equal(rows.length, 2); assert.equal(rows[0].role, "user"); assert.equal(rows[1].role, "assistant"); assert.equal(rows[1].related_message_id, rows[0].id);
      } finally { await cleanupMessages({ sessionIds: [`${agent}:${session}`] }); }
    });
  }
});
