const { existsSync, readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const { dirname } = require("node:path");
const { parse, modify, applyEdits, printParseErrorCode } = require("jsonc-parser");

function readConfig(file) {
  const raw = existsSync(file) ? readFileSync(file, "utf8") : "{}";
  const bom = raw.startsWith("\uFEFF") ? "\uFEFF" : "";
  const text = bom ? raw.slice(1) : raw;
  const errors = [];
  const value = parse(text || "{}", errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length || !value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Configuracion invalida en ${file}: ${errors.map(e => printParseErrorCode(e.error)).join(", ") || "se esperaba un objeto"}`);
  }
  return { text: text || "{}", value, bom };
}

function updateConfig(file, path, value) {
  const { text, bom } = readConfig(file);
  const updated = applyEdits(text, modify(text, path, value, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: text.includes("\r\n") ? "\r\n" : "\n" },
  }));
  if (updated === text) return false;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bom + updated + (updated.endsWith("\n") ? "" : "\n"), "utf8");
  return true;
}
module.exports = { readConfig, updateConfig };
