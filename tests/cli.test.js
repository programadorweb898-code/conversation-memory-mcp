const assert = require("node:assert/strict");
const { PassThrough } = require("node:stream");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const {
  AGENT_CHOICES,
  promptForAgent,
  resolveAgent,
  MAX_AGENT_ATTEMPTS,
} = require("../src/cli");

function createInteractiveStreams(inputText) {
  const input = new PassThrough();
  const output = new PassThrough();
  input.isTTY = true;
  output.isTTY = true;
  const outputChunks = [];
  output.on("data", (chunk) => outputChunks.push(chunk.toString()));
  input.end(inputText);
  return { input, output, getOutput: () => outputChunks.join("") };
}

describe("cli", () => {
  it("contains the interactive agent fallback", () => {
    const source = readFileSync(join(__dirname, "..", "src", "cli.js"), "utf8");

    assert.match(source, /No pude detectar automáticamente qué agente utilizás/);
    assert.match(source, /Seleccioná el agente para configurar su MCP y su política/);
    assert.match(source, /promptForAgent/);
  });

  it("retries invalid agent menu choices up to three attempts", async () => {
    const streams = createInteractiveStreams("99\n98\n1\n");
    const agent = await promptForAgent({
      input: streams.input,
      output: streams.output,
      interactive: true,
    });

    assert.equal(agent, "opencode");
    assert.match(streams.getOutput(), /Opción inválida\. Elegí un número del 1 al 17 o escribí el nombre del agente\. Intentos restantes: 2\./);
    assert.match(streams.getOutput(), /Intentos restantes: 1\./);
  });

  it("accepts an agent name instead of a menu number", async () => {
    const streams = createInteractiveStreams("codex\n");
    const agent = await promptForAgent({
      input: streams.input,
      output: streams.output,
      interactive: true,
    });

    assert.equal(agent, "codex");
  });

  it("fails after three invalid agent menu choices", async () => {
    const streams = createInteractiveStreams("99\n98\n0\n");

    await assert.rejects(
      promptForAgent({
        input: streams.input,
        output: streams.output,
        interactive: true,
      }),
      /Se agotaron los 3 intentos para seleccionar un agente\. La instalación se canceló\./,
    );

    assert.equal((streams.getOutput().match(/Opción inválida/g) || []).length, 3);
  });

  it("shows the supported agents after an unsupported --agent value", async () => {
    const streams = createInteractiveStreams("2\n");
    const result = await resolveAgent("codexx", {
      input: streams.input,
      output: streams.output,
      interactive: true,
    });

    assert.equal(result.agent, "codex");
    assert.equal(result.manual, true);
    assert.match(streams.getOutput(), /Agente no soportado: codexx\./);
    assert.match(streams.getOutput(), /1\. OpenCode/);
    assert.match(streams.getOutput(), /2\. Codex/);
  });

  it("shows the supported agents when detection fails", async () => {
    const originalCwd = process.cwd;
    process.cwd = () => join(__dirname, "non-existent-project");

    try {
      const streams = createInteractiveStreams("4\n");
      const result = await resolveAgent(null, {
        input: streams.input,
        output: streams.output,
        interactive: true,
      });

      assert.equal(result.agent, "copilot");
      assert.equal(result.manual, true);
      assert.match(streams.getOutput(), /No pude detectar automáticamente qué agente utilizás\./);
      assert.match(streams.getOutput(), /4\. GitHub Copilot/);
    } finally {
      process.cwd = originalCwd;
    }
  });

  it("accepts Ctrl+C as a clean cancellation", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    input.isTTY = true;
    output.isTTY = true;

    const promise = promptForAgent({
      input,
      output,
      interactive: true,
    });

    input.emit("SIGINT");

    await assert.rejects(promise, /Instalación cancelada por el usuario\./);
  });

  it("lists all canonical supported agents", () => {
    const names = AGENT_CHOICES.map(([, name]) => name);
    assert.deepEqual(names, [
      "opencode",
      "codex",
      "claude",
      "copilot",
      "cursor",
      "kimi",
      "gemini-cli",
      "qwen-code",
      "kilocode",
      "kiro-ide",
      "windsurf",
      "antigravity",
      "openclaw",
      "trae",
      "pi",
      "hermes",
      "generic",
    ]);
  });

  it("defines three agent selection attempts", () => {
    assert.equal(MAX_AGENT_ATTEMPTS, 3);
  });
});
