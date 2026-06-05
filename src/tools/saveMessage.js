const db = require("../database");
const { v4: uuidv4 } = require("uuid");
const { generateEmbedding, saveEmbedding } = require("../services/embeddingService");

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
            const generatedEmbedding = await generateEmbedding(content);
            await saveEmbedding(messageId, generatedEmbedding);
            resolve(true);
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