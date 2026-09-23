const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

describe("cli", () => {
  it("contains the interactive agent fallback", () => {
    const source = readFileSync(join(__dirname, "..", "src", "cli.js"), "utf8");

    assert.match(source, /No pude detectar automáticamente qué agente utilizás/);
    assert.match(source, /Seleccioná el agente para configurar su MCP y su política/);
    assert.match(source, /promptForAgent/);
  });
});
