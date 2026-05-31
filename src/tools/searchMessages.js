const db = require("../database");
const { getEmbedding } = require("../services/embeddingService");

/**
 * Busca mensajes en la base de datos usando búsqueda semántica (embeddings).
 * @param {Object} params - Parámetros de búsqueda.
 * @param {string} params.query - El término a buscar.
 * @param {string} [params.project] - (Opcional) Filtrar por proyecto.
 * @returns {Promise<Array>} - Lista de mensajes encontrados, ordenados por relevancia semántica.
 */
async function searchMessages({ query, project }) {
  // 1. Generar embedding para la consulta
  const queryEmbedding = await getEmbedding(query);

  return new Promise((resolve, reject) => {
    // 2. Obtener todos los mensajes y sus embeddings
    let sql = `
      SELECT c.*, me.embedding 
      FROM conversations c
      JOIN message_embeddings me ON c.id = me.message_id
    `;
    const params = [];

    if (project) {
      sql += ` WHERE c.project = ?`;
      params.push(project);
    }

    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);

      // 3. Calcular similitud coseno (dot product ya que están normalizados)
      const scoredResults = rows.map((row) => {
        const embedding = JSON.parse(row.embedding);
        const similarity = dotProduct(queryEmbedding, embedding);
        return { ...row, similarity };
      });

      // 4. Ordenar por similitud (descendente) y filtrar los mejores (ej. > 0.5)
      scoredResults.sort((a, b) => b.similarity - a.similarity);
      
      resolve(scoredResults);
    });
  });
}

function dotProduct(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

module.exports = searchMessages;
