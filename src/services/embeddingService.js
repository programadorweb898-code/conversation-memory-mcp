const { pipeline } = require('@xenova/transformers');

/**
 * Servicio para generar embeddings de texto de forma local.
 * Utiliza el modelo 'all-MiniLM-L6-v2'.
 */
let pipe = null;

async function getEmbedding(text) {
  if (!pipe) {
    // La primera vez que se llama, descarga o carga el modelo localmente
    pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  
  // Generar embedding
  const output = await pipe(text, { pooling: 'mean', normalize: true });
  
  // Convertir el resultado a un array plano de números
  return Array.from(output.data);
}

module.exports = { getEmbedding };
