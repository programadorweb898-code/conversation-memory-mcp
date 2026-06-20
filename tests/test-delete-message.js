const { expect } = require('chai');
const deleteMessage = require('../src/tools/deleteMessage');
const { db } = require('../src/database');
const { v4: uuidv4 } = require('uuid');

describe('Delete Message Tool', () => {
  let testMessageId;

  beforeEach((done) => {
    testMessageId = uuidv4();
    const sessionId = uuidv4();
    const project = "test-project-del";
    const role = "user";
    const content = "Este es un mensaje de prueba para eliminar.";

    db.run(
      `INSERT INTO conversations (id, session_id, project, role, content) VALUES (?, ?, ?, ?, ?)`,
      [testMessageId, sessionId, project, role, content],
      (err) => {
        if (err) return done(err);

        // También insertamos un embedding para probar la eliminación en cascada
        db.run(
          `INSERT INTO message_embeddings (message_id, embedding) VALUES (?, ?)`,
          [testMessageId, JSON.stringify([0.1, 0.2, 0.3])],
          (err) => {
            if (err) return done(err);
            done();
          }
        );
      }
    );
  });

  afterEach((done) => {
    // Limpieza de la base de datos después de cada prueba
    db.run(`DELETE FROM conversations WHERE id = ?`, [testMessageId], (err) => {
      if (err) console.error("Error cleaning up conversations:", err.message);
      db.run(`DELETE FROM message_embeddings WHERE message_id = ?`, [testMessageId], (err) => {
        if (err) console.error("Error cleaning up embeddings:", err.message);
        done();
      });
    });
  });

  it('debería eliminar un mensaje y su embedding asociado correctamente', async () => {
    await deleteMessage(testMessageId);

    // Verificar que el mensaje fue eliminado de conversations
    const conversationRow = await new Promise((resolve, reject) => {
      db.get(`SELECT * FROM conversations WHERE id = ?`, [testMessageId], (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });
    expect(conversationRow).to.be.undefined;

    // Verificar que el embedding también fue eliminado
    const embeddingRow = await new Promise((resolve, reject) => {
      db.get(`SELECT * FROM message_embeddings WHERE message_id = ?`, [testMessageId], (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });
    expect(embeddingRow).to.be.undefined;
  });

  it('debería resolver correctamente si el mensaje a eliminar no existe', async () => {
    const nonExistentId = uuidv4();
    await deleteMessage(nonExistentId);

    // Si la promesa se resuelve sin errores, la prueba es exitosa
    expect(true).to.be.true; // Simplemente para tener una aserción explícita
  });
});
