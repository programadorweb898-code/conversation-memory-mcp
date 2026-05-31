const db = require("../database");
const { v4: uuidv4 } = require("uuid");
const { getEmbedding } = require("../services/embeddingService");

async function saveMessage({
  sessionId,
  project,
  role,
  content
}) {
  const messageId = uuidv4();

  return new Promise(async (resolve, reject) => {
    try {
      // 1. Guardar mensaje
      db.run(
        `
        INSERT INTO conversations
        (id, session_id, timestamp, project, role, content)
        VALUES (?, ?, datetime('now'), ?, ?, ?)
        `,
        [messageId, sessionId, project, role, content],
        async (err) => {
          if (err) return reject(err);

          // 2. Generar y guardar embedding
          try {
            const embedding = await getEmbedding(content);
            db.run(
              `INSERT INTO message_embeddings (message_id, embedding) VALUES (?, ?)`,
              [messageId, JSON.stringify(embedding)],
              (err) => {
                if (err) console.error("Error saving embedding:", err);
                resolve(true);
              }
            );
          } catch (embeddingErr) {
            console.error("Error generating embedding:", embeddingErr);
            resolve(true); // Resolvemos true porque el mensaje sí se guardó
          }
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = saveMessage;