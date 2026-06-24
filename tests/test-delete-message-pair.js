const { expect } = require('chai');
const deleteMessagePair = require('../src/tools/deleteMessagePair');
const { db } = require('./test-helper');
const { v4: uuidv4 } = require('uuid');

describe('Delete Message Pair Tool', () => {
  let testSessionId;
  let msgId1, msgId2;

  beforeEach(async () => {
    testSessionId = uuidv4();
    msgId1 = uuidv4();
    msgId2 = uuidv4();
    const project = "test-project-pair";
    
    // Insertar un par de mensajes (pregunta y respuesta) de forma asíncrona y segura
    await db.runAsync(
      `INSERT INTO conversations (id, session_id, project, role, content, timestamp) VALUES ($1, $2, $3, $4, $5, NOW())`,
      [msgId1, testSessionId, project, 'user', 'Pregunta']
    );
    await db.runAsync(
      `INSERT INTO conversations (id, session_id, project, role, content, timestamp) VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '1 second')`,
      [msgId2, testSessionId, project, 'assistant', 'Respuesta']
    );
    
    // Añadir embeddings simulados
    await db.runAsync(`INSERT INTO message_embeddings (message_id, embedding) VALUES ($1, $2)`, [msgId1, '[0.1]']);
    await db.runAsync(`INSERT INTO message_embeddings (message_id, embedding) VALUES ($1, $2)`, [msgId2, '[0.2]']);
  });

  afterEach(async () => {
    try {
      await db.runAsync(`DELETE FROM message_embeddings WHERE message_id IN ($1, $2)`, [msgId1, msgId2]);
      await db.runAsync(`DELETE FROM conversations WHERE session_id = $1`, [testSessionId]);
    } catch (err) {
      console.error("Error en limpieza de test-delete-message-pair:", err.message);
    }
  });

  it('debería eliminar el par de mensajes si se elimina uno de ellos', async () => {
    // Eliminar la pregunta (msgId1), debería borrar también la respuesta (msgId2)
    await deleteMessagePair(msgId1);

    const rows = await db.allAsync(`SELECT id FROM conversations WHERE session_id = $1`, [testSessionId]);
    expect(rows).to.have.lengthOf(0);
  });
});
