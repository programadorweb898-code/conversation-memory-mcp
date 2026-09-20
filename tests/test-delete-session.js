const { expect } = require('chai');
const deleteSession = require('../src/tools/deleteSession');
const { db } = require('../src/database');
const { v4: uuidv4 } = require('uuid');
const fakeEmbedding = require('./helpers/fakeEmbedding');

describe('Delete Session Tool', () => {
  let testSessionId;
  let messageIds = [];
  const project = "test-project-session";

  beforeEach(async () => {
    testSessionId = uuidv4();
    messageIds = [];

    const messagesToInsert = [
      { content: "Mensaje 1 de la sesión", embedding: fakeEmbedding(0.1) },
      { content: "Mensaje 2 de la sesión", embedding: fakeEmbedding(0.2) },
      { content: "Mensaje 3 de la sesión", embedding: fakeEmbedding(0.3) },
    ];

    for (const msg of messagesToInsert) {
      const messageId = uuidv4();
      messageIds.push(messageId);

      await db.runAsync(
        `INSERT INTO conversations (id, session_id, project, role, content) VALUES ($1, $2, $3, $4, $5)`,
        [messageId, testSessionId, project, "user", msg.content]
      );

      await db.runAsync(
        `INSERT INTO message_embeddings (message_id, embedding) VALUES ($1, $2)`,
        [messageId, msg.embedding]
      );
    }
  });

  afterEach(async () => {
    try {
      await db.runAsync(`DELETE FROM message_embeddings WHERE message_id IN (SELECT id FROM conversations WHERE session_id = $1)`, [testSessionId]);
      await db.runAsync(`DELETE FROM conversations WHERE session_id = $1`, [testSessionId]);
    } catch (err) {
      console.error("Error en limpieza de test-delete-session:", err.message);
    }
  });

  it('debería eliminar todos los mensajes y sus embeddings asociados para una sesión', async () => {
    await deleteSession({ sessionId: testSessionId, project });

    const conversationRows = await db.allAsync(`SELECT * FROM conversations WHERE session_id = $1`, [testSessionId]);
    expect(conversationRows).to.have.lengthOf(0);

    const placeholders = messageIds.map((_, i) => `$${i + 1}`).join(',');
    const embeddingRows = await db.allAsync(`SELECT * FROM message_embeddings WHERE message_id IN (${placeholders})`, messageIds);
    expect(embeddingRows).to.have.lengthOf(0);
  });

  it('debería resolver correctamente si la sesión a eliminar no existe', async () => {
    const nonExistentSessionId = uuidv4();
    await deleteSession({ sessionId: nonExistentSessionId, project });
    const conversations = await db.allAsync(
      'SELECT id FROM conversations WHERE session_id = $1',
      [nonExistentSessionId]
    );
    expect(conversations).to.have.lengthOf(0);
  });});
