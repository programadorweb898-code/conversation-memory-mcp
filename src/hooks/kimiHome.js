const { existsSync } = require("node:fs");
const { join } = require("node:path");
function kimiHome(homeDir) {
  return process.env.KIMI_SHARE_DIR || (existsSync(join(homeDir, ".kimi/config.toml")) ? join(homeDir, ".kimi") : join(homeDir, ".kimi-code"));
}
module.exports = { kimiHome };
