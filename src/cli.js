#!/usr/bin/env node

const { startStdioServer } = require("./stdio");
const { installPolicy } = require("./installer");

function printHelp() {
  console.log([
    "conversation-memory-mcp",
    "",
    "Uso:",
    "  conversation-memory-mcp             Inicia el servidor MCP por stdio",
    "  conversation-memory-mcp install     Instala la política de prioridad de memoria",
    "  conversation-memory-mcp install --agent <agente>",
    "",
    "Agentes soportados: generic, opencode, codex, claude, copilot",
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

async function main() {
  const parsed = parseArgs(process.argv);

  if (parsed.command === "help") {
    printHelp();
    return;
  }

  if (parsed.command === "install") {
    const result = installPolicy({ agent: parsed.agent });
    console.log(
      `[conversation-memory-mcp] política ${result.changed ? "instalada/actualizada" : "sin cambios"} en ${result.file} (agente: ${result.agent})`
    );
    return;
  }

  await startStdioServer();
}

main().catch((error) => {
  console.error(`[conversation-memory-mcp] ${error.message}`);
  process.exit(1);
});
