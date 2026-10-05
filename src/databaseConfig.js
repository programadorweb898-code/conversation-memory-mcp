const { join } = require("node:path");
const { homedir } = require("node:os");
const dotenv = require("dotenv");

const DATABASE_URL_ENV = "CONVERSATION_MEMORY_DATABASE_URL";

function getGlobalDatabaseEnvFile() {
  const configRoot = process.platform === "win32"
    ? process.env.APPDATA || homedir()
    : process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(configRoot, "conversation-memory-mcp", ".env");
}

function getDatabaseUrl() {
  if (process.env[DATABASE_URL_ENV]) return process.env[DATABASE_URL_ENV];

  dotenv.config({ path: join(process.cwd(), ".env"), override: false });
  if (process.env[DATABASE_URL_ENV]) return process.env[DATABASE_URL_ENV];

  dotenv.config({ path: getGlobalDatabaseEnvFile(), override: false });
  return process.env[DATABASE_URL_ENV] || "";
}

function describeDatabaseTarget(connectionString) {
  try {
    const url = new URL(connectionString);
    return {
      host: url.hostname,
      database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    };
  } catch {
    return { host: "desconocido", database: "desconocida" };
  }
}

function getPgSslOptions() {
  return process.env.PGSSL_REJECT_UNAUTHORIZED === "false"
    ? { rejectUnauthorized: false }
    : undefined;
}

module.exports = {
  DATABASE_URL_ENV,
  describeDatabaseTarget,
  getDatabaseUrl,
  getGlobalDatabaseEnvFile,
  getPgSslOptions,
};