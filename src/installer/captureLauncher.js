const { readFileSync, writeFileSync, existsSync, mkdirSync } = require("node:fs");
const { join, dirname } = require("node:path");
const { version } = require("../../package.json");
function captureCommand(file, agent) {
  const source = readFileSync(join(__dirname, "../hooks/launcher.cjs"), "utf8").replaceAll("__VERSION__", version);
  if (!existsSync(file) || readFileSync(file, "utf8") !== source) {
    mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, source, "utf8");
  }
  // Base64 keeps arbitrary path characters out of the host's shell grammar.
  const encoded = Buffer.from(file).toString("base64");
  return `node -e "require(Buffer.from('${encoded}','base64').toString())" -- capture --agent ${agent} --cm-package conversation-memory-mcp@${version}`;
}
module.exports = { captureCommand };
