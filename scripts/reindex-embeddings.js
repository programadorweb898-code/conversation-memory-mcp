#!/usr/bin/env node

const { createEmbeddingReindexer } = require("../src/services/embeddingReindex");
const {
  initializeEmbeddingPipeline,
  isEmbeddingsEnabled,
} = require("../src/services/embeddingService");
const { getConfig } = require("../src/config");

function printHelp() {
  console.log(`
Reindexa los embeddings existentes con el proveedor/modelo configurado actualmente.

Uso:
  npm run reindex:embeddings
  npm run reindex:embeddings -- --owner maxi --batch-size 25
  npm run reindex:embeddings -- --scope summaries
  npm run reindex:embeddings -- --dry-run

Opciones:
  --owner <owner>         Limita el reindexado a un owner.
  --batch-size <n>        Cantidad máxima de filas procesadas por lote.
  --scope <scope>         all | messages | summaries (default: all).
  --dry-run               Escanea y muestra qué se reindexaría, sin escribir.
  --help                  Muestra esta ayuda.
`);
}

function parseArgs(argv) {
  const options = {
    owner: null,
    batchSize: undefined,
    scope: "all",
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    const next = argv[index + 1];
    if (arg === "--owner") {
      if (!next) throw new Error("--owner requiere un valor.");
      options.owner = next;
      index += 1;
      continue;
    }

    if (arg === "--batch-size") {
      if (!next) throw new Error("--batch-size requiere un valor.");
      options.batchSize = next;
      index += 1;
      continue;
    }

    if (arg === "--scope") {
      if (!next) throw new Error("--scope requiere un valor.");
      options.scope = next;
      index += 1;
      continue;
    }

    throw new Error(`Opción desconocida: ${arg}. Usá --help.`);
  }

  return options;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);

  if (options.help) {
    printHelp();
    return;
  }

  if (!options.dryRun && !isEmbeddingsEnabled()) {
    throw new Error(
      "ENABLE_EMBEDDINGS=false impide reindexar. Ejecutá el reindexado con embeddings habilitados.",
    );
  }

  if (!options.dryRun) {
    console.log("Inicializando proveedor de embeddings...");
    await initializeEmbeddingPipeline();
  }

  const config = getConfig();
  const reindexer = createEmbeddingReindexer();

  console.log(
    `Iniciando reindexado: scope=${options.scope}, owner=${options.owner ?? "todos"}, batchSize=${options.batchSize ?? config.embeddings.batchSize}, dryRun=${options.dryRun}`,
  );

  const result = await reindexer.reindexEmbeddings(options);

  console.log("Reindexado completado.");
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Error en el reindexado de embeddings:", error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  printHelp,
  main,
};
