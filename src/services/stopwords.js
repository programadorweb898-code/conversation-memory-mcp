// Lista de palabras vacías (stopwords) en español para limpiar consultas semánticas.
// Incluye artículos, preposiciones, conjunciones, pronombres y verbos auxiliares comunes.
const stopwords = new Set([
  "a", "al", "algo", "algunas", "algunos", "ante", "antes", "como", "con", "contra",
  "cual", "cuando", "de", "del", "desde", "donde", "durante", "e", "el", "ella",
  "ellas", "ellos", "en", "entre", "era", "erais", "eran", "eras", "es", "esa",
  "esas", "ese", "eso", "esos", "esta", "estaba", "estabais", "estaban", "estabas",
  "estad", "estada", "estadas", "estado", "estados", "estamos", "estando", "estar",
  "estaremos", "estará", "estarán", "estarás", "estaré", "estaréis", "estaríamos",
  "estaríamos", "estarían", "estarías", "estas", "este", "estemos", "esto", "estos",
  "estoy", "estuve", "estuviera", "estuvierais", "estuvieran", "estuvieras",
  "estuvieron", "estuviese", "estuvieseis", "estuviesen", "estuvieses", "estuvimos",
  "estuviste", "estuvisteis", "estuviéramos", "estuviésemos", "estuvo", "está",
  "estábamos", "estáis", "están", "estás", "esté", "estéis", "estén", "estés",
  "fue", "fuera", "fuerais", "fueran", "fueras", "fueron", "fuese", "fueseis",
  "fuesen", "fueses", "fui", "fuimos", "fuiste", "fuisteis", "fuéramos", "fuésemos",
  "ha", "habida", "habidas", "habido", "habidos", "habiendo", "habremos", "habrá",
  "habrán", "habrás", "habré", "habréis", "habríamos", "habrían", "habrías",
  "habéis", "había", "habíais", "habían", "habías", "han", "has", "hasta", "hay",
  "haya", "hayamos", "hayan", "hayas", "hayáis", "he", "hemos", "hube", "hubiera",
  "hubierais", "hubieran", "hubieras", "hubieron", "hubiese", "hubieseis",
  "hubiesen", "hubieses", "hubimos", "hubiste", "hubisteis", "hubiéramos",
  "hubiésemos", "hubo", "la", "las", "le", "les", "lo", "los", "me", "mi", "mis",
  "mucho", "muchos", "muy", "más", "mí", "mía", "mías", "mío", "míos", "nada",
  "ni", "no", "nos", "nosotras", "nosotros", "nuestra", "nuestras", "nuestro",
  "nuestros", "o", "os", "otra", "otras", "otro", "otros", "para", "pero", "poco",
  "por", "porque", "que", "quien", "quienes", "qué", "se", "sea", "seamos", "sean",
  "seas", "sea", "sentid", "sentida", "sentidas", "sentido", "sentidos", "ser",
  "seremos", "será", "serán", "serás", "seré", "seréis", "seríamos", "serían",
  "serías", "si", "sido", "siendo", "sin", "sino", "so", "sobre", "somos", "son",
  "soy", "su", "sus", "suya", "suyas", "suyo", "suyos", "sí", "también", "tanto",
  "te", "tendremos", "tendrá", "tendrán", "tendrás", "tendré", "tendréis",
  "tendríamos", "tendrían", "tendrías", "tened", "tenemos", "tengo", "tenido",
  "tenidos", "teniendo", "tenéis", "tenía", "teníais", "tenían", "tenías", "ti",
  "tiene", "tienen", "tienes", "todo", "todos", "tu", "tus", "tuya", "tuyas",
  "tuyo", "tuyos", "tú", "un", "una", "unas", "uno", "unos", "vosotras",
  "vosotros", "vuestra", "vuestras", "vuestro", "vuestros", "y", "ya", "yo"
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
