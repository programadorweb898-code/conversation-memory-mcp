import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, rename, readdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
export const stableId = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function visibleText(content) {
  if (typeof content === "string") return content;
  return (Array.isArray(content) ? content : []).filter(p => p?.type === "text" && !p.thought).map(p => p.text || "").join("\n");
}
// Only fixed package/agent arguments reach the shell. Conversation text is stdin.
export async function sendCapture(agent, input, { spawnProcess = spawn, stateRoot } = {}) {
  if (!["pi", "openclaw", "kilocode"].includes(agent)) throw new Error("Unsupported bridge agent");
  try {
    const root = process.platform === "win32" ? process.env.APPDATA || homedir() : process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
    const directory = join(stateRoot || root, "conversation-memory-mcp", "capture", "bridge", stableId([agent, input.cwd]));
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, stableId(input) + ".json");
    const temporary = file + `.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(input), { mode: 0o600 }); await rename(temporary, file);
    const args = ["--yes", "conversation-memory-mcp@__VERSION__", "capture", "--agent", agent];
    const started = Date.now();
    for (const name of (await readdir(directory)).filter(n => n.endsWith(".json")).slice(0, 10)) {
    if (Date.now() - started >= 20000) break;
    let failed = false;
    await new Promise((resolve, reject) => {
      const win = process.platform === "win32";
      const child = spawnProcess(win ? process.env.ComSpec || "cmd.exe" : "npx", win ? ["/d", "/s", "/c", `npx.cmd ${args.join(" ")}`] : args,
        { stdio: ["pipe", "ignore", "pipe"], windowsHide: true, timeout: 25000 });
      child.on("error", reject);
      child.on("close", code => code === 0 && !failed ? resolve() : reject(new Error("Capture process failed")));
      child.stderr.on("data", data => { if (String(data).includes("[conversation-memory]")) failed = true; });
      child.stdin.on("error", () => {});
      readFile(join(directory, name), "utf8").then(data => child.stdin.end(data), reject);
    });
    await unlink(join(directory, name)).catch(e => { if (e.code !== "ENOENT") throw e; });
    }
  } catch { console.error("[conversation-memory] Capture bridge failed; check capture pending files."); }
}
