const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { sync: spawnSync } = require("cross-spawn");
const { readConfig, updateConfig } = require("./configFiles");
const pkg = require("../../package.json");

const PAYLOAD = ["conversation-memory.mjs", "opencode-v1.mjs", "opencode-v2.mjs", "opencode-config.js", "mcp-client.js", "save-cache.js", "save-confirmation.js", "projectIdentity.mjs"];
function checkedRun(runner, command, args, cwd) {
  const result = runner(command, args, { cwd, timeout: 120000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  if (!result || result.error || result.status !== 0) throw new Error(`Fallo ${command}: ${result?.error?.message || String(result?.stderr || "salida no disponible").slice(0, 500)}`);
  return String(result.stdout || "");
}
function detectOpenCodeVersion({ cwd, version, commandRunner = spawnSync }) {
  let output = version;
  if (!output) {
    try { output = checkedRun(commandRunner, "opencode", ["--version"], cwd); }
    catch { throw new Error("No pude detectar la version de OpenCode. Comproba opencode --version o usa --opencode-version <version>."); }
  }
  const match = String(output).trim().match(/(?:^|\s)v?(\d+)\.(\d+)\.(\d+)(?:$|\s)/);
  if (!match || ![1, 2].includes(Number(match[1]))) throw new Error(`Version OpenCode no soportada: ${output}. Se admiten versiones estables 1.x y 2.x.`);
  return { version: `${match[1]}.${match[2]}.${match[3]}`, major: Number(match[1]) };
}
function installOpenCode({ cwd, homeDir, version, commandRunner = spawnSync }) {
  const detected = detectOpenCodeVersion({ cwd, version, commandRunner });
  const candidates = [join(cwd, ".opencode", "opencode.jsonc"), join(cwd, ".opencode", "opencode.json"), join(cwd, "opencode.jsonc"), join(cwd, "opencode.json")];
  const file = candidates.find(existsSync) || candidates[1];
  const config = readConfig(file).value;
  for (const base of [join(cwd, ".opencode"), ...(homeDir ? [join(homeDir, ".config", "opencode")] : [])]) {
    for (const dir of ["plugin", "plugins"]) for (const ext of ["ts", "js", "mjs"]) {
      if (existsSync(join(base, dir, `conversation-memory.${ext}`))) throw new Error("Ya existe un plugin manual conversation-memory. Retiralo de plugin/plugins antes de activar la captura administrada para evitar duplicados.");
    }
  }
  const destination = join(cwd, ".opencode", "conversation-memory-plugin");
  mkdirSync(destination, { recursive: true });
  let changed = false;
  function write(file, text) {
    if (!existsSync(file) || readFileSync(file, "utf8") !== text) { writeFileSync(file, text, "utf8"); changed = true; }
  }
  for (const name of PAYLOAD) write(join(destination, name), readFileSync(join(__dirname, "..", "..", "plugins", name), "utf8"));
  write(join(destination, "entry.mjs"), `export { default } from "./opencode-v${detected.major}.mjs";\n`);
  const dependencies = { "@modelcontextprotocol/sdk": pkg.dependencies["@modelcontextprotocol/sdk"], "jsonc-parser": pkg.dependencies["jsonc-parser"] };
  const manifest = JSON.stringify({ name: "conversation-memory-opencode-local", version: pkg.version, private: true, type: "commonjs", main: "entry.mjs", exports: { ".": "./entry.mjs" }, dependencies }, null, 2) + "\n";
  const manifestFile = join(destination, "package.json");
  const dependenciesChanged = !existsSync(manifestFile) || readFileSync(manifestFile, "utf8") !== manifest;
  write(manifestFile, manifest);
  const marker = join(destination, ".dependencies-installed.json");
  if (dependenciesChanged || !existsSync(marker) || readFileSync(marker, "utf8") !== manifest || !existsSync(join(destination, "node_modules", "@modelcontextprotocol", "sdk", "package.json")) || !existsSync(join(destination, "node_modules", "jsonc-parser", "package.json"))) {
    checkedRun(commandRunner, "npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], destination);
    writeFileSync(marker, manifest, "utf8");
  }
  const pluginKey = detected.major === 1 ? "plugin" : "plugins";
  const oldKey = detected.major === 1 ? "plugins" : "plugin";
  const isManaged = entry => typeof entry === "string" && entry.includes("conversation-memory-plugin");
  const others = (config[pluginKey] || []).filter(entry => !isManaged(entry));
  const unique = [...new Map(others.map(entry => [JSON.stringify(entry), entry])).values()];
  const entry = pathToFileURL(detected.major === 1 ? join(destination, "entry.mjs") : destination).href;
  changed = updateConfig(file, [pluginKey], [...unique, entry]) || changed;
  if (config[oldKey]?.some(isManaged)) {
    const remaining = config[oldKey].filter(entry => !isManaged(entry));
    changed = updateConfig(file, [oldKey], remaining.length ? remaining : undefined) || changed;
  }
  // An explicit package spec avoids npm treating a same-named working project
  // as the executable package (and attempting a local package symlink).
  const server = { ...(config.mcp?.["conversation-memory"] || {}), type: "local", command: ["npx", "--yes", `--package=conversation-memory-mcp@${pkg.version}`, "--", "conversation-memory-mcp"] };
  changed = updateConfig(file, ["mcp", "conversation-memory"], server) || changed;
  return { changed, file, supported: true, capture: "automatic", plugin: { directory: destination, version: detected.version, api: `v${detected.major}` } };
}
module.exports = { installOpenCode, detectOpenCodeVersion, PAYLOAD };
