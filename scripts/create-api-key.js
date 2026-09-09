#!/usr/bin/env node
// Gestión de api_keys para el MCP multi-tenant.
// Uso:
//   node scripts/create-api-key.js new --name "<dueño>" [--project <proyecto>] [--json]
//   node scripts/create-api-key.js list [--json]
//   node scripts/create-api-key.js revoke <id> [--json]
//
// El token plano se imprime UNA sola vez al crearlo; solo se guarda su hash.

const dotenv = require("dotenv");
dotenv.config();

const {
  createApiKey,
  listApiKeys,
  revokeApiKey,
} = require("../src/services/apiKeyService");

function parseArgs(argv) {
  const args = { _: [], name: null, project: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--name" || arg === "-n") {
      args.name = argv[++i];
    } else if (arg === "--project" || arg === "-p") {
      args.project = argv[++i];
    } else if (arg === "--json") {
      args.json = true;
    } else {
      args._.push(arg);
    }
  }
  return args;
}

function output(obj, json) {
  console.log(json ? JSON.stringify(obj, null, 2) : obj);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL environment variable is required.");
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || "new";

  if (command === "new") {
    if (!args.name) {
      console.error('Falta --name. Ejemplo: node scripts/create-api-key.js new --name "maxi-portatil" --project tiktok-mcp');
      process.exit(1);
    }
    const keyUrl = args.project ? `Y URL: ${process.env.MCP_URL || "(URL del servidor)"}` : "";
    const { token, key } = await createApiKey({ name: args.name, project: args.project });
    output({
      ok: true,
      id: key.id,
      name: key.name,
      project: key.project || "(todos los proyectos)",
      token,
      note: "Guardá este token: solo se muestra una vez.",
    }, args.json);
    if (!args.json) {
      console.log(keyUrl);
    }
    process.exit(0);
  }

  if (command === "list") {
    const keys = await listApiKeys();
    output(keys, args.json);
    process.exit(0);
  }

  if (command === "revoke") {
    const id = args._[1];
    if (!id) {
      console.error("Falta el id. Ejemplo: node scripts/create-api-key.js revoke <id>");
      process.exit(1);
    }
    const key = await revokeApiKey(id);
    if (!key) {
      console.error(`No existe la api_key ${id}`);
      process.exit(1);
    }
    output({ ok: true, id: key.id, disabled: true }, args.json);
    process.exit(0);
  }

  console.error(`Comando desconocido: ${command}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});