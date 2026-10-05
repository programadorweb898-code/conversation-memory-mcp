#!/usr/bin/env node

const { startStdioServer } = require("./stdio");
const { install, detectAgent } = require("./installer");
const { getDefaultScope, normalizeAgent, normalizeScope, resolveScope } = require("./installer/mcpConfig");
const { setupDatabase } = require("./installer/database");
const { confirmMigrationTarget, runMigrations } = require("../scripts/migrate");
const { getDatabaseUrl } = require("./databaseConfig");

const AGENT_CHOICES = [
  ["1", "opencode", "OpenCode"],
  ["2", "codex", "Codex"],
  ["3", "claude", "Claude Code"],
  ["4", "copilot", "GitHub Copilot (VS Code)"],
  ["5", "github-copilot", "GitHub Copilot CLI"],
  ["6", "cursor", "Cursor"],
  ["7", "kimi", "Kimi Code"],
  ["8", "gemini-cli", "Gemini CLI"],
  ["9", "qwen-code", "Qwen Code"],
  ["10", "kilocode", "Kilo Code"],
  ["11", "kiro-ide", "Kiro IDE"],
  ["12", "windsurf", "Windsurf"],
  ["13", "antigravity", "Antigravity"],
  ["14", "openclaw", "OpenClaw"],
  ["15", "trae", "Trae"],
  ["16", "pi", "Pi"],
  ["17", "hermes", "Hermes"],
  ["18", "generic", "Otro / configuración manual"],
];

const MAX_AGENT_ATTEMPTS = 3;

function printHelp() {
  console.log([
    "conversation-memory-mcp",
    "",
    "Uso:",
    "  conversation-memory-mcp             Inicia el servidor MCP por stdio",
    "  conversation-memory-mcp install     Configura base de datos + MCP + política",
    "  conversation-memory-mcp install --agent <agente>",
    "  conversation-memory-mcp install --agent <agente> --scope <scope>",
    "  conversation-memory-mcp migrate     Migra una base dedicada tras confirmación",
    "",
    "Scopes disponibles:",
    "  project  Configuración dentro del proyecto (predeterminado)",
    "  global   Configuración global del agente, cuando está soportada",
    "",
    "Los agentes que solo soportan configuración global se instalan globalmente automáticamente.",
    "",
    "Si CONVERSATION_MEMORY_DATABASE_URL no existe, el instalador ofrece:",
    "  1. indicar una base dedicada a Conversation Memory",
    "  2. crear una base dedicada con Neon Claimable",
    "Las migraciones requieren confirmar el host, la base y el schema antes de ejecutarse.",
    "",
    "Si no puede detectar el agente, muestra un menú para seleccionarlo.",
    "",
    "Agentes soportados:",
    `  ${AGENT_CHOICES.map(([, name]) => name).join(", ")}`,
  ].join("\n"));
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0];
  if (command === "--help" || command === "-h") return { command: "help" };
  if (!command || command === "serve") return { command: "serve" };
  if (command === "migrate") {
    if (args.length > 1) throw new Error("migrate no acepta argumentos adicionales");
    return { command: "migrate" };
  }
  if (command !== "install") throw new Error(`Comando desconocido: ${command}`);

  let agent = null;
  let scope;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--agent") {
      agent = args[++i];
      if (!agent) throw new Error("--agent requiere un valor");
    } else if (args[i] === "--scope") {
      scope = normalizeScope(args[++i]);
    } else {
      throw new Error(`Argumento desconocido: ${args[i]}`);
    }
  }
  return { command, agent, scope };
}

function printAgentChoices(output = process.stdout) {
  output.write([
    "",
    "Seleccioná el agente para configurar su MCP y su política:",
    "",
    ...AGENT_CHOICES.map(([number, , label]) => `  ${number}. ${label}`),
    "",
    "También podés escribir el nombre del agente (por ejemplo: codex).",
  ].join("\n") + "\n");
}

function findAgentChoice(answer) {
  const normalized = answer.trim().toLowerCase();
  return AGENT_CHOICES.find(([number, name]) => number === normalized || name === normalized);
}

async function promptForAgent({ reason = "", input = process.stdin, output = process.stdout, interactive = true } = {}) {
  if (interactive && (!input.isTTY || !output.isTTY)) {
    throw new Error("No pude seleccionar el agente en un terminal interactivo. Ejecutá nuevamente con --agent <agente>.");
  }

  if (reason) output.write(`\n${reason}\n`);
  printAgentChoices(output);

  const readline = require("node:readline");
  const rl = readline.createInterface({ input, output });

  let interrupted = false;
  const handleInterrupt = () => {
    interrupted = true;
    rl.close();
  };

  rl.on("SIGINT", handleInterrupt);
  input.on("SIGINT", handleInterrupt);

  try {
    let attempt = 0;

    for await (const line of rl) {
      if (interrupted) break;

      attempt += 1;
      const answer = line.trim();
      const choice = findAgentChoice(answer);

      if (choice) return choice[1];

      const remaining = MAX_AGENT_ATTEMPTS - attempt;
      output.write(
        `Opción inválida. Elegí un número del 1 al ${AGENT_CHOICES.length} o escribí el nombre del agente.` +
        (remaining > 0 ? ` Intentos restantes: ${remaining}.` : "") +
        "\n",
      );

      if (remaining === 0) {
        throw new Error("Se agotaron los 3 intentos para seleccionar un agente. La instalación se canceló.");
      }

      output.write("Selección [1-" + AGENT_CHOICES.length + "]: ");
    }

    if (interrupted) {
      throw new Error("Instalación cancelada por el usuario.");
    }

    throw new Error("No se recibió una selección de agente. La instalación se canceló.");
  } finally {
    rl.removeListener("SIGINT", handleInterrupt);
    input.removeListener("SIGINT", handleInterrupt);
    rl.close();
  }
}

async function resolveAgent(agent, { input = process.stdin, output = process.stdout, interactive = true } = {}) {
  if (agent) {
    try {
      return { agent: normalizeAgent(agent), manual: false };
    } catch {
      return {
        agent: await promptForAgent({
          reason: `Agente no soportado: ${agent}.`,
          input,
          output,
          interactive,
        }),
        manual: true,
      };
    }
  }

  const detectedAgent = detectAgent(process.cwd());
  if (detectedAgent !== "generic") {
    return { agent: detectedAgent, manual: false };
  }

  return {
    agent: await promptForAgent({
      reason: "No pude detectar automáticamente qué agente utilizás.",
      input,
      output,
      interactive,
    }),
    manual: true,
  };
}

function printStep(message) {
  console.log(`→ ${message}`);
}

function printSuccess(message) {
  console.log(`✓ ${message}`);
}

async function main() {
  const parsed = parseArgs(process.argv);
  if (parsed.command === "help") return printHelp();

  if (parsed.command === "migrate") {
    const connectionString = getDatabaseUrl();
    if (!connectionString) {
      throw new Error("CONVERSATION_MEMORY_DATABASE_URL environment variable is required.");
    }
    if (!(await confirmMigrationTarget(connectionString))) {
      throw new Error("Migración cancelada.");
    }
    await runMigrations({ confirmed: true });
    return;
  }

  if (parsed.command === "install") {
    const resolved = await resolveAgent(parsed.agent);

    const effectiveScope = resolveScope(resolved.agent, parsed.scope);

    if (parsed.scope === "global" && !["claude", "cursor", "gemini-cli", "github-copilot", "qwen-code", "antigravity", "windsurf", "openclaw", "hermes"].includes(resolved.agent)) {
      throw new Error("El scope global no está implementado para este agente.");
    }

    if (parsed.scope === "project" && getDefaultScope(resolved.agent) === "global") {
      throw new Error(`${resolved.agent} solo admite configuración global; omití --scope project.`);
    }
    printSuccess(`Agente seleccionado: ${resolved.agent}${resolved.manual ? " (seleccionado manualmente)" : " (detectado automáticamente)"}`);
    printStep("Configurando base de datos...");
    const database = await setupDatabase({ scope: effectiveScope });

    printStep("Configurando MCP y política...");
    const result = install({ agent: resolved.agent, scope: parsed.scope });

    console.log("");
    printSuccess(`Base de datos: configurada (${database.source})`);
    printSuccess(`Agente: ${resolved.agent}${resolved.manual ? " (seleccionado manualmente)" : " (detectado automáticamente)"}`);
    printSuccess(`Scope MCP: ${effectiveScope}${parsed.scope == null && effectiveScope === "global" ? " (automático)" : ""}`);
    printSuccess(`Política: ${result.changed ? "instalada/actualizada" : "sin cambios"} -> ${result.file}`);

    if (result.mcp.supported === false) {
      console.log("[conversation-memory-mcp] MCP: este agente tiene soporte de política, pero su configuración MCP requiere un adaptador específico.");
    } else {
      printSuccess(`MCP: ${result.mcp.changed ? "configurado/actualizado" : "sin cambios"} -> ${result.mcp.file}`);
    }

    console.log("");
    printSuccess("Instalación completada.");
    console.log("Reiniciá tu agente para aplicar la configuración.");
    return;
  }

  await startStdioServer();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[conversation-memory-mcp] ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  AGENT_CHOICES,
  MAX_AGENT_ATTEMPTS,
  parseArgs,
  printAgentChoices,
  promptForAgent,
  resolveAgent,
};
