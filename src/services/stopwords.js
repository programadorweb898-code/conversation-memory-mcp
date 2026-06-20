// Lista de palabras vacías (stopwords) en español para limpiar consultas semánticas.
// Basada en listas comunes para procesamiento de lenguaje natural.
const stopwords = new Set([
  "el", "la", "los", "las", "un", "una", "unos", "unas",
  "y", "o", "u", "e",
  "de", "del", "al", "a", "en", "por", "para", "con", "sin",
  "que", "quien", "quienes", "donde", "cuando",
  "este", "esta", "estos", "estas",
  "mi", "tu", "su", "nuestro", "vuestro"
]);

/**
 * Filtra las palabras vacías de una cadena de texto.
 */
function removeStopwords(text) {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(word => !stopwords.has(word))
    .join(" ");
}

module.exports = removeStopwords;
