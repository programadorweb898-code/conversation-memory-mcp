#!/usr/bin/env node

const { startStdioServer } = require("./stdio");
const { install, detectAgent } = require("./installer");
const { normalizeAgent } = require("./installer/mcpConfig");
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

const MAX_AGENT_ATTEMPTS = 3;

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

function printAgentChoices(output = process.stdout) {
  output.write([
    "",
    "Seleccioná el agente para configurar su MCP y su política:",
    "",
    ...AGENT_CHOICES.map(([number, , label]) => `  ${number}. ${label}`),
  ].join("\n") + "\n");
}

async function promptForAgent({ reason = "", input = process.stdin, output = process.stdout, interactive = true } = {}) {
  if (interactive && (!input.isTTY || !output.isTTY)) {
    throw new Error("No pude seleccionar el agente en un terminal interactivo. Ejecutá nuevamente con --agent <agente>.");
  }

  if (reason) output.write(`\n${reason}\n`);
  printAgentChoices(output);

  const readline = require("node:readline");
  const rl = readline.createInterface({ input, output });

  try {
    let attempt = 0;

    for await (const line of rl) {
      attempt += 1;
      const answer = line.trim();
      const choice = AGENT_CHOICES.find(([number]) => number === answer);

      if (choice) return choice[1];

      const remaining = MAX_AGENT_ATTEMPTS - attempt;
      if (remaining > 0) {
        output.write(`Opción inválida. Elegí un número del 1 al 7. Intentos restantes: ${remaining}.\n`);
        output.write("Número del agente: ");
      } else {
        throw new Error("Se agotaron los 3 intentos para seleccionar un agente. La instalación se canceló.");
      }
    }

    throw new Error("No se recibió una selección de agente. La instalación se canceló.");
  } finally {
    rl.close();
  }
}

async function resolveAgent(agent, { input = process.stdin, output = process.stdout, interactive = true } = {}) {
  if (agent) {
    try {
      return { agent: normalizeAgent(agent), manual: false };
    } catch (error) {
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

async function main() {
  const parsed = parseArgs(process.argv);
  if (parsed.command === "help") return printHelp();

  if (parsed.command === "install") {
    const resolved = await resolveAgent(parsed.agent);

    // El agente debe ser válido antes de tocar la base de datos.
    const database = await setupDatabase();
    const result = install({ agent: resolved.agent });

    console.log(`[conversation-memory-mcp] base de datos: configurada (${database.source})`);
    console.log(`[conversation-memory-mcp] agente: ${resolved.agent}${resolved.manual ? " (seleccionado manualmente)" : " (detectado automáticamente)"}`);
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
