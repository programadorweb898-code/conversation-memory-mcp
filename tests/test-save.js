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
    sinon.restore();

    for (const sessionId of testSessionIds) {
      try {
        await db.runAsync(`DELETE FROM message_embeddings WHERE message_id IN (SELECT id FROM conversations WHERE session_id = $1)`, [sessionId]);
        await db.runAsync(`DELETE FROM conversations WHERE session_id = $1`, [sessionId]);
      } catch (err) {
        console.error("Error en limpieza de test-save:", err.message);
      }
    }
    testSessionIds.length = 0;
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

  it('should skip MCP protocol messages and not persist them in Neon', async () => {
    const sessionId = uuidv4();
    testSessionIds.push(sessionId);

    const params = {
      sessionId,
      project: 'protocol-project',
      role: 'user',
      content: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', params: {} }),
    };

    const result = await saveMessage(params);

    expect(result.success).to.equal(true);
    expect(result.messageId).to.equal(null);

    const retrievedMessage = await db.getAsync(`SELECT * FROM conversations WHERE session_id = $1`, [sessionId]);
    expect(retrievedMessage).to.not.exist;
    expect(queueStub.called).to.be.false;
  });

  it('should reject if Zod validation fails for missing required fields', async () => {
    const params = {
      project: 'test-project',
      role: 'user',
      content: 'Invalid message',
    };

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

  it('should reject saving a message if the session already belongs to another project', async () => {
    const sessionId = uuidv4();
    testSessionIds.push(sessionId);

    await saveMessage({ sessionId, project: 'proj-a', role: 'user', content: 'Primer mensaje' });

    let error;
    try {
      await saveMessage({ sessionId, project: 'proj-b', role: 'user', content: 'Mensaje mezclado' });
    } catch (e) {
      error = e;
    }

    expect(error).to.exist;
    expect(error.code).to.equal('PROJECT_CONFLICT');
    expect(queueStub.calledOnce).to.be.true;
  });

  it('should reject concurrent writes that try to assign one session to different projects', async () => {
    const sessionId = uuidv4();
    testSessionIds.push(sessionId);

    const results = await Promise.allSettled([
      saveMessage({ sessionId, project: 'proj-a', role: 'user', content: 'Mensaje A' }),
      saveMessage({ sessionId, project: 'proj-b', role: 'user', content: 'Mensaje B' }),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).to.have.length(1);
    expect(rejected).to.have.length(1);
    expect(rejected[0].reason.code).to.equal('PROJECT_CONFLICT');

    const messages = await db.allAsync(
      `SELECT project FROM conversations WHERE session_id = $1`,
      [sessionId]
    );
    expect(messages).to.have.length(1);
    expect(['proj-a', 'proj-b']).to.include(messages[0].project);
  });

  it('should persist all concurrent messages for the same session and project', async () => {
    const sessionId = uuidv4();
    testSessionIds.push(sessionId);

    const count = 20;
    const results = await Promise.all(
      Array.from({ length: count }, (_, index) => saveMessage({
        sessionId,
        project: 'concurrent-project',
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `Concurrent message ${index}`,
        agentId: `agent-${index % 4}`,
      }))
    );

    expect(results).to.have.length(count);
    expect(new Set(results.map((result) => result.messageId)).size).to.equal(count);

    const messages = await db.allAsync(
      `SELECT id, sequence_id FROM conversations WHERE session_id = $1 ORDER BY sequence_id ASC`,
      [sessionId]
    );
    expect(messages).to.have.length(count);
    expect(new Set(messages.map((message) => message.id)).size).to.equal(count);
    expect(new Set(messages.map((message) => message.sequence_id)).size).to.equal(count);
    expect(queueStub.callCount).to.equal(count);
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
    expect(result.success).to.be.true;
    expect(result.messageId).to.exist;

    const retrievedMessage = await db.getAsync(`SELECT * FROM conversations WHERE session_id = $1`, [sessionId]);
    expect(retrievedMessage).to.exist;
  });
});
