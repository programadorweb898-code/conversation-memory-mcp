const { expect } = require('chai');
const sinon = require('sinon');
const { v4: uuidv4 } = require('uuid');

const { db } = require('./test-helper');
const saveMessage = require('../src/tools/saveMessage');

describe('saveMessage', () => {
  let queueStub;
  const testSessionIds = [];

  beforeEach(async () => {
    queueStub = sinon.stub();
    sinon.replace(require('../src/services/embeddingQueue'), 'addTask', queueStub);
  });

  afterEach(async () => {
    sinon.restore(); // Restore all stubs
    
    // Limpieza segura: eliminar solo las sesiones generadas en los tests
    for (const sessionId of testSessionIds) {
      try {
        await db.runAsync(`DELETE FROM message_embeddings WHERE message_id IN (SELECT id FROM conversations WHERE session_id = $1)`, [sessionId]);
        await db.runAsync(`DELETE FROM conversations WHERE session_id = $1`, [sessionId]);
      } catch (err) {
        console.error("Error en limpieza de test-save:", err.message);
      }
    }
    testSessionIds.length = 0; // Vaciar array
  });

  it('should save a message successfully with required fields', async () => {
    const sessionId = uuidv4();
    testSessionIds.push(sessionId);

    const params = {
      sessionId,
      project: 'test-project',
      role: 'user',
      content: 'Hello, world!',
    };

    await saveMessage(params);

    const retrievedMessage = await db.getAsync(`SELECT * FROM conversations WHERE session_id = $1`, [sessionId]);

    expect(retrievedMessage).to.exist;
    expect(retrievedMessage.project).to.equal(params.project);
    expect(retrievedMessage.role).to.equal(params.role);
    expect(retrievedMessage.content).to.equal(params.content);
    expect(retrievedMessage.agent_id).to.be.null; 
    expect(queueStub.calledOnce).to.be.true; 
  });

  it('should save a message successfully with all fields including agentId', async () => {
    const sessionId = uuidv4();
    testSessionIds.push(sessionId);

    const params = {
      sessionId,
      project: 'another-project',
      role: 'assistant',
      content: 'I am an assistant.',
      agentId: 'agent-123',
    };

    await saveMessage(params);

    const retrievedMessage = await db.getAsync(`SELECT * FROM conversations WHERE session_id = $1`, [sessionId]);

    expect(retrievedMessage).to.exist;
    expect(retrievedMessage.project).to.equal(params.project);
    expect(retrievedMessage.role).to.equal(params.role);
    expect(retrievedMessage.content).to.equal(params.content);
    expect(retrievedMessage.agent_id).to.equal(params.agentId);
    expect(queueStub.calledOnce).to.be.true;
  });

  it('should reject if Zod validation fails for missing required fields', async () => {
    const params = {
      project: 'test-project',
      role: 'user',
      content: 'Invalid message',
    }; // Missing sessionId

    let error;
    try {
      await saveMessage(params);
    } catch (e) {
      error = e;
    }

    expect(error).to.exist;
    expect(error.name).to.equal('ZodError');
    expect(queueStub.called).to.be.false; 
  });

  it('should resolve true even if embedding generation fails, but message is saved', async () => {
    const sessionId = uuidv4();
    testSessionIds.push(sessionId);

    sinon.restore(); 
    sinon.stub(require('../src/services/embeddingService'), 'generateEmbedding').rejects(new Error('Embedding generation failed'));
    sinon.replace(require('../src/services/embeddingService'), 'saveEmbedding', sinon.stub().resolves(true));

    const params = {
      sessionId,
      project: 'error-project',
      role: 'user',
      content: 'Message with embedding error',
    };

    const result = await saveMessage(params);
    expect(result).to.be.true; 

    const retrievedMessage = await db.getAsync(`SELECT * FROM conversations WHERE session_id = $1`, [sessionId]);
    expect(retrievedMessage).to.exist; 
  });
});
