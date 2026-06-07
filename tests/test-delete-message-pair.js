const { expect } = require('chai');
const deleteMessagePair = require('../src/tools/deleteMessagePair');
const db = require('../src/database');
const { v4: uuidv4 } = require('uuid');

describe('Delete Message Pair Tool', () => {
  let testSessionId;
  let msgId1, msgId2;

  beforeEach((done) => {
    testSessionId = uuidv4();
    msgId1 = uuidv4();
    msgId2 = uuidv4();
    const project = "test-project-pair";
    
    // Insertar un par de mensajes (pregunta y respuesta)
    db.serialize(() => {
      db.run(`INSERT INTO conversations (id, session_id, project, role, content, timestamp) VALUES (?, ?, ?, ?, ?, ?)`,
        [msgId1, testSessionId, project, 'user', 'Pregunta', Date.now()]);
      db.run(`INSERT INTO conversations (id, session_id, project, role, content, timestamp) VALUES (?, ?, ?, ?, ?, ?)`,
        [msgId2, testSessionId, project, 'assistant', 'Respuesta', Date.now() + 1000]);
      
      // Añadir embeddings simulados
      db.run(`INSERT INTO message_embeddings (message_id, embedding) VALUES (?, ?)`, [msgId1, '[0.1]']);
      db.run(`INSERT INTO message_embeddings (message_id, embedding) VALUES (?, ?)`, [msgId2, '[0.2]'], done);
    });
  });

  afterEach((done) => {
    db.run(`DELETE FROM conversations WHERE session_id = ?`, [testSessionId], done);
  });

  it('debería eliminar el par de mensajes si se elimina uno de ellos', async () => {
    // Eliminar la pregunta (msgId1), debería borrar también la respuesta (msgId2)
    await deleteMessagePair(msgId1);

    const rows = await new Promise((resolve) => {
      db.all(`SELECT id FROM conversations WHERE session_id = ?`, [testSessionId], (err, rows) => resolve(rows));
    });
    
    expect(rows).to.have.lengthOf(0);
  });
});
