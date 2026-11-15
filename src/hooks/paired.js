const { readFile, mkdir, writeFile, rename } = require("node:fs/promises");
const { join } = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const hash = value => createHash("sha256").update(value).digest("hex");
async function pairedMessages(agent, input, stateDir) {
  if (!stateDir) throw new Error("Missing capture state directory");
  const file = join(stateDir, hash(JSON.stringify([agent, input.cwd, input.session_id, input.turn_id || "current"])) + ".pair.json");
  let state = {};
  try { state = JSON.parse(await readFile(file, "utf8")); } catch (e) { if (e.code !== "ENOENT") throw e; }
  if (input.hook_event_name === "UserPromptSubmit") {
    if (typeof input.prompt !== "string" || !input.prompt.trim()) return [];
    if (!state.id || state.completed || state.prompt !== input.prompt) state = { id: input.turn_id || randomUUID(), prompt: input.prompt };
  } else if (input.hook_event_name === "Stop") {
    if (!state.id) throw new Error("User prompt was not captured for this turn");
    if (typeof input.last_assistant_message === "string" && input.last_assistant_message.trim()) {
      state.answer = input.last_assistant_message;
      state.completed = true;
    }
  } else return [];
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const pending = file + "." + randomUUID() + ".tmp";
  await writeFile(pending, JSON.stringify(state), { mode: 0o600 });
  await rename(pending, file);
  return [{ id: `${state.id}:user`, role: "user", content: state.prompt },
    ...(state.answer ? [{ id: `${state.id}:assistant:${hash(state.answer)}`, role: "assistant", content: state.answer }] : [])];
}
module.exports = { pairedMessages };
