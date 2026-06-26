const { expect } = require('chai');
const deleteMessage = require('../src/tools/deleteMessage');
const { db } = require('./test-helper');
const { v4: uuidv4 } = require('uuid');
const fakeEmbedding = require('./helpers/fakeEmbedding');

describe('Delete Message Tool', () => {
  let testMessageId;
  let testSessionId;

  beforeEach(async () => {
    testMessageId = uuidv4();
    testSessionId = uuidv4();
    const project = "test-project-del";
    const role = "user";
    const content = "Este es un mensaje de prueba para eliminar.";

    await db.runAsync(
      `INSERT INTO conversations (id, session_id, project, role, content) VALUES ($1, $2, $3, $4, $5)`,
      [testMessageId, testSessionId, project, role, content]
    );

    // También insertamos un embedding para probar la eliminación en cascada
    await db.runAsync(
      `INSERT INTO message_embeddings (message_id, embedding) VALUES ($1, $2)`,
      [testMessageId, fakeEmbedding(0.1)]
    );
  });

  afterEach(async () => {
    // Limpieza de la base de datos después de cada prueba
    try {
      await db.runAsync(`DELETE FROM message_embeddings WHERE message_id = $1`, [testMessageId]);
      await db.runAsync(`DELETE FROM conversations WHERE id = $1`, [testMessageId]);
    } catch (err) {
      console.error("Error en limpieza de test-delete-message:", err.message);
    }
  });

  it('debería eliminar un mensaje y su embedding asociado correctamente', async () => {
    await deleteMessage(testMessageId);

    // Verificar que el mensaje fue eliminado de conversations
    const conversationRow = await db.getAsync(`SELECT * FROM conversations WHERE id = $1`, [testMessageId]);
    expect(conversationRow).to.be.undefined;

    // Verificar que el embedding también fue eliminado
    const embeddingRow = await db.getAsync(`SELECT * FROM message_embeddings WHERE message_id = $1`, [testMessageId]);
    expect(embeddingRow).to.be.undefined;
  });

  it('debería resolver correctamente si el mensaje a eliminar no existe', async () => {
    const nonExistentId = uuidv4();
    await deleteMessage(nonExistentId);

    expect(true).to.be.true; 
  });
});
