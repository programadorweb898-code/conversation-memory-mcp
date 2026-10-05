const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const spawn = require("cross-spawn");
const { dirname, join } = require("node:path");
const { tmpdir } = require("node:os");
const { Client } = require("pg");
const dotenv = require("dotenv");
const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");
const { confirmMigrationTarget, runMigrations } = require("../../scripts/migrate");
const {
  DATABASE_URL_ENV,
  describeDatabaseTarget,
  getDatabaseUrl,
  getGlobalDatabaseEnvFile,
  getPgSslOptions,
} = require("../databaseConfig");

const ENV_FILE = ".env";
const GITIGNORE_FILE = ".gitignore";

function getDatabaseEnvFile(cwd, scope = "project") {
  return scope === "global" ? getGlobalDatabaseEnvFile() : join(cwd, ENV_FILE);
}

function loadEnvironment(cwd, scope = "project") {
  dotenv.config({ path: getDatabaseEnvFile(cwd, scope), override: false });
  return getDatabaseUrl();
}

async function testDatabaseConnection(connectionString) {
  if (!connectionString) throw new Error(`${DATABASE_URL_ENV} is required.`);
  const client = new Client({
    connectionString,
    ...(getPgSslOptions() ? { ssl: getPgSslOptions() } : {}),
    connectionTimeoutMillis: 10000,
  });
  try {
    await client.connect();
    await client.query("SELECT 1");
  } finally {
    await client.end().catch(() => {});
  }
}

function upsertEnvValue(cwd, key, value) {
  const file = join(cwd, ENV_FILE);
  mkdirSync(cwd, { recursive: true });
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
    const child = spawn(executable, args, { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`El comando ${command} terminó con código ${code ?? "desconocido"}.`));
    });
  });
}

async function provisionClaimableNeon() {
  const isolatedCwd = mkdtempSync(join(tmpdir(), "conversation-memory-neon-"));
  console.log("[conversation-memory-mcp] No se encontró una base dedicada para Conversation Memory.");
  console.log("[conversation-memory-mcp] Se abrirá Neon Claimable desde un directorio temporal para no tocar el .env de la aplicación.");
  console.log("[conversation-memory-mcp] La base sin reclamar expira después de 72 horas.");
  console.log("[conversation-memory-mcp] Neon mostrará un enlace de reclamación durante este paso; guardalo y abrilo para transferir el proyecto a tu organización de Neon.");
  try {
    await runCommand("npx", ["-y", "neon@latest", "claim", "create", "--env-pull"], isolatedCwd);
    for (const envFile of [".env", ".env.local"]) {
      const file = join(isolatedCwd, envFile);
      if (!existsSync(file)) continue;
      const values = dotenv.parse(readFileSync(file, "utf8"));
      const connectionString = values[DATABASE_URL_ENV] || values.DATABASE_URL || "";
      if (connectionString) return connectionString;
    }
    throw new Error("Neon terminó correctamente, pero no se encontró la conexión en el directorio temporal.");
  } finally {
    rmSync(isolatedCwd, { recursive: true, force: true });
  }
}

async function promptForDatabase(cwd, input = stdin, output = stdout) {
  const rl = readline.createInterface({ input, output });
  try {
    console.log("");
    console.log(`No hay una ${DATABASE_URL_ENV} configurada.`);
    console.log("1) Usar una base ya dedicada exclusivamente a Conversation Memory");
    console.log("2) Crear una base dedicada con Neon Claimable");
    const choice = (await rl.question("Elegí una opción [1/2]: ")).trim();
    if (choice === "1") {
      const value = (await rl.question(`${DATABASE_URL_ENV}: `)).trim();
      if (!value) throw new Error(`${DATABASE_URL_ENV} no puede estar vacía.`);
      return value;
    }
    if (choice === "2") return provisionClaimableNeon(cwd);
    throw new Error("Opción inválida. Elegí 1 o 2.");
  } finally {
    rl.close();
  }
}

async function setupDatabase({
  cwd = process.cwd(),
  interactive = true,
  input = stdin,
  output = stdout,
  scope = "project",
  testConnection = testDatabaseConnection,
  migrate = runMigrations,
} = {}) {
  const projectRoot = cwd;
  const envFile = getDatabaseEnvFile(projectRoot, scope);
  let connectionString = loadEnvironment(projectRoot, scope);
  if (!connectionString) {
    if (!interactive) throw new Error(`${DATABASE_URL_ENV} no está configurada. Ejecutá la instalación en modo interactivo.`);
    connectionString = await promptForDatabase(projectRoot, input, output);
  }
  await testConnection(connectionString);
  if (!interactive || !(await confirmMigrationTarget(connectionString, input, output))) {
    throw new Error("Migración cancelada: se requiere confirmar que el destino está dedicado a Conversation Memory.");
  }
  upsertEnvValue(dirname(envFile), DATABASE_URL_ENV, connectionString);
  process.env[DATABASE_URL_ENV] = connectionString;
  if (scope !== "global") ensureEnvIgnored(projectRoot);
  await migrate({ confirmed: true });
  return {
    configured: true,
    file: envFile,
    source: connectionString.includes("neon.tech") ? "neon" : "existing",
    target: describeDatabaseTarget(connectionString),
  };
}

module.exports = {
  confirmMigrationTarget,
  ensureEnvIgnored,
  getDatabaseEnvFile,
  loadEnvironment,
  promptForDatabase,
  provisionClaimableNeon,
  setupDatabase,
  testDatabaseConnection,
  upsertEnvValue,
};