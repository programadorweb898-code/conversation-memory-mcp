const { expect } = require('chai');
const deleteSession = require('../src/tools/deleteSession');
const db = require('../src/database');
const { v4: uuidv4 } = require('uuid');

describe('Delete Session Tool', () => {
  let testSessionId;
  let messageIds = [];

  beforeEach((done) => {
    testSessionId = uuidv4();
    messageIds = [];
    const project = "test-project-session";
    const role = "user";

    // Insertar varios mensajes para la misma sesión
    const messagesToInsert = [
      { content: "Mensaje 1 de la sesión", embedding: [0.1, 0.1, 0.1] },
      { content: "Mensaje 2 de la sesión", embedding: [0.2, 0.2, 0.2] },
      { content: "Mensaje 3 de la sesión", embedding: [0.3, 0.3, 0.3] },
    ];

    let insertsCompleted = 0;
    const totalInserts = messagesToInsert.length;

    messagesToInsert.forEach((msg, index) => {
      const messageId = uuidv4();
      messageIds.push(messageId);

      db.run(
        `INSERT INTO conversations (id, session_id, project, role, content) VALUES (?, ?, ?, ?, ?)`,
        [messageId, testSessionId, project, role, msg.content],
        (err) => {
          if (err) return done(err);

          db.run(
            `INSERT INTO message_embeddings (message_id, embedding) VALUES (?, ?)`,
            [messageId, JSON.stringify(msg.embedding)],
            (err) => {
              if (err) return done(err);
              insertsCompleted++;
              if (insertsCompleted === totalInserts) {
                done();
              }
            }
          );
        }
      );
    });
  });

  afterEach((done) => {
    // Limpieza de la base de datos después de cada prueba
    db.serialize(() => {
      db.run(`DELETE FROM message_embeddings WHERE message_id IN (SELECT id FROM conversations WHERE session_id = ?)`, [testSessionId], (err) => {
        if (err) console.error("Error cleaning up embeddings:", err.message);
        db.run(`DELETE FROM conversations WHERE session_id = ?`, [testSessionId], (err) => {
          if (err) console.error("Error cleaning up conversations:", err.message);
          done();
        });
      });
    });
  });

  it('debería eliminar todos los mensajes y sus embeddings asociados para una sesión', async () => {
    await deleteSession(testSessionId);

    // Verificar que no hay mensajes para la sesión en conversations
    const conversationRows = await new Promise((resolve, reject) => {
      db.all(`SELECT * FROM conversations WHERE session_id = ?`, [testSessionId], (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
    expect(conversationRows).to.have.lengthOf(0);

    // Verificar que no hay embeddings para los mensajes de la sesión
    const embeddingRows = await new Promise((resolve, reject) => {
      db.all(`SELECT * FROM message_embeddings WHERE message_id IN (${messageIds.map(() => '?').join(',')})`, messageIds, (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
    expect(embeddingRows).to.have.lengthOf(0);
  });

  it('debería resolver correctamente si la sesión a eliminar no existe', async () => {
    const nonExistentSessionId = uuidv4();
    await deleteSession(nonExistentSessionId);

    // Si la promesa se resuelve sin errores, la prueba es exitosa
    expect(true).to.be.true;
  });
});
