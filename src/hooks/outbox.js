const { mkdir, writeFile, readFile, rename, readdir, unlink, stat, rmdir } = require("node:fs/promises");
const { join } = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function enqueue(stateDir, item) {
  const directory = join(stateDir, "outbox", hash(item.scoped.projectPath));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, `${hash(item)}.json`);
  const temporary = file + "." + randomUUID() + ".tmp";
  await writeFile(temporary, JSON.stringify(item), { mode: 0o600 });
  await rename(temporary, file);
  return { directory, file };
}
async function drain(directory, persist, { limit = 25, budgetMs = 20000 } = {}) {
  const lock = join(directory, ".lock");
  try { await mkdir(lock); } catch (e) {
    if (e.code !== "EEXIST") throw e;
    // Reclaim only old leases. A killed hook cannot permanently disable retries.
    if (Date.now() - (await stat(lock)).mtimeMs > 120000) {
      await rmdir(lock).catch(() => {});
    }
    return;
  }
  const started = Date.now();
  let failure;
  try {
    const files = await Promise.all((await readdir(directory)).filter(n => n.endsWith(".json")).map(async name => ({ name, time: (await stat(join(directory, name))).mtimeMs })));
    files.sort((a, b) => a.time - b.time || a.name.localeCompare(b.name));
    for (const { name } of files.slice(0, limit)) {
      if (Date.now() - started >= budgetMs) break;
      const file = join(directory, name);
      try {
        await persist(JSON.parse(await readFile(file, "utf8")));
        await unlink(file);
      } catch (error) { failure ||= error; }
    }
  } finally { await rmdir(lock); }
  if (failure) throw failure;
}
module.exports = { enqueue, drain };
