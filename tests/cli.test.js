const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { join } = require("node:path");

describe("cli", () => {
  it("documents the interactive agent fallback", () => {
    const output = execFileSync(process.execPath, [join(__dirname, "..", "src", "cli.js"), "--help"], {
      encoding: "utf8",
    });

    assert.match(output, /Si no puede detectar el agente, muestra un menú para seleccionarlo/);
  });
});
