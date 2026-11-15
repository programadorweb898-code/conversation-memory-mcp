// Standalone persistent hook launcher: no npm dependencies are needed to spool input.
const fs = require("node:fs/promises");
const { join } = require("node:path");
const { homedir } = require("node:os");
const { createHash, randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const hash = data => createHash("sha256").update(data).digest("hex");
const allowed = new Set(["claude", "cursor", "gemini-cli", "codex", "qwen-code", "github-copilot", "kimi", "windsurf", "hermes", "trae"]);
async function launch() {
  let output = {};
  try {
    const agent = process.argv[process.argv.indexOf("--agent") + 1];
    if (!allowed.has(agent)) throw new Error("Unsupported hook");
    let raw = "";
    for await (const chunk of process.stdin) { raw += chunk; if (Buffer.byteLength(raw) > 8 * 1024 * 1024) throw new Error("Input too large"); }
    const input = JSON.parse(raw);
    const stored = {};
    for (const key of ["session_id", "sessionId", "trajectory_id", "conversation_id", "conversationId", "cwd", "workspace_roots", "workspacePaths", "turn_id", "hook_event_name", "transcript_path", "transcriptPath", "generation_id", "prompt", "last_assistant_message", "prompt_response", "text"]) {
      if (input[key] !== undefined) stored[key] = input[key];
    }
    if (input.tool_info?.transcript_path) stored.tool_info = { transcript_path: input.tool_info.transcript_path };
    if (input.extra) stored.extra = { turn_id: input.extra.turn_id, user_message: input.extra.user_message, assistant_response: input.extra.assistant_response };
    raw = JSON.stringify(stored);
    if (agent === "cursor" && input.hook_event_name === "beforeSubmitPrompt") output = { continue: true };
    const cwd = input.cwd || input.workspace_roots?.[0] || input.workspacePaths?.[0] || process.cwd();
    const root = process.platform === "win32" ? process.env.APPDATA || homedir() : process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
    const directory = join(root, "conversation-memory-mcp/capture/launchers", hash(JSON.stringify([agent, cwd])));
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, hash(raw) + ".json");
    try { await fs.stat(file); } catch (e) {
      if (e.code !== "ENOENT") throw e;
      const temporary = file + "." + randomUUID() + ".tmp";
      await fs.writeFile(temporary, raw, { mode: 0o600 }); await fs.rename(temporary, file);
    }
    const files = await Promise.all((await fs.readdir(directory)).filter(n => n.endsWith(".json")).map(async name => ({ name, time: (await fs.stat(join(directory, name))).mtimeMs })));
    files.sort((a, b) => a.time - b.time || a.name.localeCompare(b.name));
    const started = Date.now();
    for (const { name } of files.slice(0, 10)) {
      if (Date.now() - started >= 20000) break;
      const payload = await fs.readFile(join(directory, name), "utf8");
      const args = ["--yes", "conversation-memory-mcp@__VERSION__", "capture", "--agent", agent];
      let stdout = "";
      let recorderWarning = false;
      await new Promise((resolve, reject) => {
        const win = process.platform === "win32";
        const child = spawn(win ? process.env.ComSpec || "cmd.exe" : "npx", win ? ["/d", "/s", "/c", `npx.cmd ${args.join(" ")}`] : args,
          { windowsHide: true, stdio: ["pipe", "pipe", "pipe"], timeout: 25000, cwd, env: { ...process.env, CM_CAPTURE_ACK: "1" } });
        child.on("error", reject); child.on("close", code => code === 0 ? resolve() : reject(new Error("Capture process failed")));
        child.stdout.on("data", data => { if (stdout.length < 65536) stdout += data; });
        child.stderr.on("data", data => { if (String(data).includes("[conversation-memory]")) recorderWarning = true; }); child.stdin.on("error", () => {}); child.stdin.end(payload);
      });
      if (!JSON.parse(stdout).queued) throw new Error("Capture was not queued");
      if (recorderWarning) console.error("[conversation-memory] Database save pending; retained locally for retry.");
      await fs.unlink(join(directory, name)).catch(e => { if (e.code !== "ENOENT") throw e; });
    }
  } catch { console.error("[conversation-memory] Capture pending; check hook configuration and pending files."); }
  process.stdout.write(JSON.stringify(output) + "\n");
}
void launch();
