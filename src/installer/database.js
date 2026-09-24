const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const { spawn } = require("node:child_process");
const { join } = require("node:path");
const { Client } = require("pg");
const dotenv = require("dotenv");
const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");
const { runMigrations } = require("../../scripts/migrate");

const ENV_FILE = ".env";
const GITIGNORE_FILE = ".gitignore";

function loadEnvironment(cwd) {
  dotenv.config({ path: join(cwd, ENV_FILE), override: false });
  return process.env.DATABASE_URL || "";
}

async function testDatabaseConnection(connectionString) {
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    await client.query("SELECT 1");
  } finally {
    await client.end().catch(() => {});
  }
}

function upsertEnvValue(cwd, key, value) {
  const file = join(cwd, ENV_FILE);
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  const line = `${key}="${escaped}"`;
  const pattern = new RegExp(`^\\s*${key}=.*$`, "m");
  const updated = pattern.test(current)
    ? current.replace(pattern, line)
    : `${current.trimEnd()}${current.trimEnd() ? "\n" : ""}${line}\n`;
  if (updated !== current) writeFileSync(file, updated, "utf8");
}

function ensureEnvIgnored(cwd) {
  const file = join(cwd, GITIGNORE_FILE);
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  const entries = current.split(/\r?\n/).map((line) => line.trim());
  if (entries.includes(".env") || entries.includes(".env/")) return false;
  const updated = `${current.trimEnd()}${current.trimEnd() ? "\n" : ""}.env\n`;
  writeFileSync(file, updated, "utf8");
  return true;
}

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const executable = process.platform === "win32" && command === "npx" ? "npx.cmd" : command;
    const child = spawn(executable, args, { cwd, stdio: "inherit", shell: false });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`El comando ${command} terminó con código ${code ?? "desconocido"}.`));
    });
  });
}

async function provisionClaimableNeon(cwd) {
  console.log("[conversation-memory-mcp] No se encontró DATABASE_URL.");
  console.log("[conversation-memory-mcp] Se abrirá el flujo de Neon Claimable para crear una base PostgreSQL temporal.");
  console.log("[conversation-memory-mcp] La base sin reclamar expira después de 72 horas.");
  console.log("[conversation-memory-mcp] Neon mostrará un enlace de reclamación durante este paso; guardalo y abrilo para transferir el proyecto a tu organización de Neon.");
  await runCommand("npx", ["-y", "neon@latest", "claim", "create", "--env-pull"], cwd);
  dotenv.config({ path: join(cwd, ENV_FILE), override: true });
  const connectionString = process.env.DATABASE_URL || "";
  if (!connectionString) throw new Error("Neon terminó correctamente, pero no dejó DATABASE_URL en .env.");
  return connectionString;
}

async function promptForDatabase(cwd, input = stdin, output = stdout) {
  const rl = readline.createInterface({ input, output });
  try {
    console.log("");
    console.log("No hay una DATABASE_URL configurada.");
    console.log("1) Introducir una DATABASE_URL existente");
    console.log("2) Crear una base PostgreSQL con Neon Claimable");
    const choice = (await rl.question("Elegí una opción [1/2]: ")).trim();
    if (choice === "1") {
      const value = (await rl.question("DATABASE_URL: ")).trim();
      if (!value) throw new Error("DATABASE_URL no puede estar vacía.");
      upsertEnvValue(cwd, "DATABASE_URL", value);
      return value;
    }
    if (choice === "2") return provisionClaimableNeon(cwd);
    throw new Error("Opción inválida. Elegí 1 o 2.");
  } finally {
    rl.close();
  }
}

async function setupDatabase({ cwd = process.cwd(), interactive = true } = {}) {
  const projectRoot = cwd;
  let connectionString = loadEnvironment(projectRoot);
  if (!connectionString) {
    if (!interactive) throw new Error("DATABASE_URL no está configurada. Ejecutá la instalación en modo interactivo o configurá .env manualmente.");
    connectionString = await promptForDatabase(projectRoot);
  }
  await testDatabaseConnection(connectionString);
  process.env.DATABASE_URL = connectionString;
  ensureEnvIgnored(projectRoot);
  await runMigrations();
  return { configured: true, file: join(projectRoot, ENV_FILE), source: connectionString.includes("neon.tech") ? "neon" : "existing" };
}

module.exports = { ensureEnvIgnored, loadEnvironment, provisionClaimableNeon, setupDatabase, testDatabaseConnection, upsertEnvValue };