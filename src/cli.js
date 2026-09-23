#!/usr/bin/env node

const { startStdioServer } = require("./stdio");
const { install, detectAgent } = require("./installer");
const { setupDatabase } = require("./installer/database");

const AGENT_CHOICES = [
  ["1", "opencode", "OpenCode"],
  ["2", "codex", "Codex"],
  ["3", "claude", "Claude Code"],
  ["4", "cursor", "Cursor"],
  ["5", "kimi", "Kimi Code"],
  ["6", "kiro-ide", "Kiro IDE"],
  ["7", "generic", "Otro / configuración manual"],
];

function printHelp() {
  console.log([
    "conversation-memory-mcp",
    "",
    "Uso:",
    "  conversation-memory-mcp             Inicia el servidor MCP por stdio",
    "  conversation-memory-mcp install     Configura base de datos + MCP + política",
    "  conversation-memory-mcp install --agent <agente>",
    "",
    "Si DATABASE_URL no existe, el instalador ofrece:",
    "  1. usar una conexión PostgreSQL existente",
    "  2. crear una base temporal con Neon Claimable",
    "",
    "Si no puede detectar el agente, muestra un menú para seleccionarlo.",
    "",
    "Agentes: opencode, codex, claude, copilot, cursor, kimi, gemini-cli,",
    "         qwen-code, kilocode, kiro-ide, windsurf, antigravity,",
    "         openclaw, trae, pi, hermes",
  ].join("\n"));
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0];
  if (command === "--help" || command === "-h") return { command: "help" };
  if (!command || command === "serve") return { command: "serve" };
  if (command !== "install") throw new Error(`Comando desconocido: ${command}`);

  let agent = null;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--agent") {
      agent = args[++i];
      if (!agent) throw new Error("--agent requiere un valor");
    } else {
      throw new Error(`Argumento desconocido: ${args[i]}`);
    }
  }
  return { command, agent };
}

function printAgentChoices() {
  console.log([
    "",
    "No pude detectar automáticamente qué agente utilizás.",
    "Seleccioná el agente para configurar su MCP y su política:",
    "",
    ...AGENT_CHOICES.map(([number, , label]) => `  ${number}. ${label}`),
  ].join("\n"));
}

async function promptForAgent() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("No pude detectar el agente automáticamente en un terminal interactivo. Ejecutá nuevamente con --agent <agente>.");
  }

  printAgentChoices();

  const readline = require("node:readline/promises");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    const answer = (await rl.question("\nNúmero del agente: ")).trim();
    const choice = AGENT_CHOICES.find(([number]) => number === answer);
    if (!choice) throw new Error("Selección inválida. Usá un número del 1 al 7.");
    return choice[1];
  } finally {
    rl.close();
  }
}

async function main() {
  const parsed = parseArgs(process.argv);
  if (parsed.command === "help") return printHelp();

  if (parsed.command === "install") {
    const database = await setupDatabase();
    const detectedAgent = parsed.agent || detectAgent(process.cwd());
    const selectedAgent = detectedAgent === "generic"
      ? await promptForAgent()
      : detectedAgent;
    const result = install({ agent: selectedAgent });

    console.log(`[conversation-memory-mcp] base de datos: configurada (${database.source})`);
    console.log(`[conversation-memory-mcp] agente: ${selectedAgent}${detectedAgent === "generic" ? " (seleccionado manualmente)" : " (detectado automáticamente)"}`);
    console.log(`[conversation-memory-mcp] política: ${result.changed ? "instalada/actualizada" : "sin cambios"} -> ${result.file}`);

    if (result.mcp.supported === false) {
      console.log("[conversation-memory-mcp] MCP: este agente tiene soporte de política, pero su configuración MCP requiere un adaptador específico.");
    } else {
      console.log(`[conversation-memory-mcp] MCP: ${result.mcp.changed ? "configurado/actualizado" : "sin cambios"} -> ${result.mcp.file}`);
    }
    return;
  }

  await startStdioServer();
}

main().catch((error) => {
  console.error(`[conversation-memory-mcp] ${error.message}`);
  process.exit(1);
});
