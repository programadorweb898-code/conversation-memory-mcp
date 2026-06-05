const db = require("../database");
const { generateEmbedding } = require("../services/embeddingService"); // Importar generateEmbedding

/**
 * Busca mensajes en la base de datos.
 * Si se proporciona keyword, realiza búsqueda por texto (LIKE).
 * Si no, realiza búsqueda semántica (embeddings).
 * @param {Object} params - Parámetros de búsqueda.
 * @param {string} [params.query] - El término para búsqueda semántica.
 * @param {string} [params.keyword] - El término para búsqueda por palabras clave.
 * @param {string} [params.project] - (Opcional) Filtrar por proyecto.
 * @returns {Promise<Array>} - Lista de mensajes encontrados.
 */
async function searchMessages({ query, keyword, project }) {
  return new Promise((resolve, reject) => {
    // Si queremos búsqueda semántica, necesitamos los embeddings, hacemos JOIN.
    // Si solo queremos búsqueda por keyword, no necesitamos JOIN con embeddings.
    let sql = `SELECT c.* ${query ? ', me.embedding' : ''} FROM conversations c`;
    if (query) {
      sql += ` JOIN message_embeddings me ON c.id = me.message_id`;
    }

    const params = [];
    const whereClauses = [];

    if (project) {
      whereClauses.push(`c.project = ?`);
      params.push(project);
    }

    // Búsqueda por palabras clave (si se proporciona)
    if (keyword) {
      whereClauses.push(`c.content LIKE ?`);
      params.push(`%${keyword}%`);
    }

    if (whereClauses.length > 0) {
      sql += ` WHERE ` + whereClauses.join(` AND `);
    }

    db.all(sql, params, async (err, rows) => {
      if (err) return reject(err);

      // Si se pidió búsqueda semántica
      if (query) {
        const queryEmbeddingJson = await generateEmbedding(query);
        const queryEmbedding = JSON.parse(queryEmbeddingJson);

        if (!queryEmbedding || !Array.isArray(queryEmbedding)) {
          return reject(new Error("No se pudo generar el embedding para la consulta."));
        }

        // Calcular similitud coseno
        const scoredResults = rows.map((row) => {
          const embedding = JSON.parse(row.embedding);
          const similarity = dotProduct(queryEmbedding, embedding);
          return { ...row, similarity };
        });

        // Ordenar por similitud
        scoredResults.sort((a, b) => b.similarity - a.similarity);
        return resolve(scoredResults);
      } 

      resolve(rows);
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
