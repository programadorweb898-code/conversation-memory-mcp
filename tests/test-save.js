const { expect } = require('chai');
const sinon = require('sinon');
const { v4: uuidv4 } = require('uuid');

// Set up in-memory database for testing
process.env.DATABASE_PATH = ':memory:';

// Import db and saveMessage AFTER setting the environment variable
const db = require('../src/database');
const saveMessage = require('../src/tools/saveMessage');
const { generateEmbedding, saveEmbedding } = require('../src/services/embeddingService');

describe('saveMessage', () => {
  let embeddingStub;

  beforeEach((done) => {
    // Stub the embedding service to prevent actual external calls during tests
    embeddingStub = sinon.stub().resolves('mock_embedding_string');
    sinon.replace(require('../src/services/embeddingService'), 'generateEmbedding', embeddingStub);
    sinon.replace(require('../src/services/embeddingService'), 'saveEmbedding', sinon.stub().resolves(true));

    db.serialize(() => {
      db.run(`DROP TABLE IF EXISTS conversations`);
      db.run(`DROP TABLE IF EXISTS message_embeddings`);
      db.run(`DROP TABLE IF EXISTS session_summaries`);
      db.run(`
        CREATE TABLE conversations (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          project TEXT,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          agent_id TEXT
        )
      `);
      db.run(`
        CREATE TABLE message_embeddings (
          message_id TEXT PRIMARY KEY,
          embedding TEXT NOT NULL,
          FOREIGN KEY(message_id) REFERENCES conversations(id)
        )
      `);
      db.run(`
        CREATE TABLE session_summaries (
          session_id TEXT PRIMARY KEY,
          summary TEXT NOT NULL,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, done); // `done` is called after the last run
    });
  });

  afterEach((done) => {
    sinon.restore(); // Restore all stubs
    db.close((err) => {
      if (err) return done(err);
      // Re-open db connection to ensure it's fresh for the next test
      // This is crucial for ':memory:' databases
      require('../src/database'); 
      done();
    });
  });

  it('should save a message successfully with required fields', async () => {
    const params = {
      sessionId: uuidv4(),
      project: 'test-project',
      role: 'user',
      content: 'Hello, world!',
    };

    await saveMessage(params);

    const retrievedMessage = await new Promise((resolve, reject) => {
      db.get(`SELECT * FROM conversations WHERE session_id = ?`, [params.sessionId], (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });

    expect(retrievedMessage).to.exist;
    expect(retrievedMessage.project).to.equal(params.project);
    expect(retrievedMessage.role).to.equal(params.role);
    expect(retrievedMessage.content).to.equal(params.content);
    expect(retrievedMessage.agent_id).to.be.null; // agentId is optional, should be null by default
    expect(embeddingStub.calledOnce).to.be.true; // Check if embedding was attempted
  });

  it('should save a message successfully with all fields including agentId', async () => {
    const params = {
      sessionId: uuidv4(),
      project: 'another-project',
      role: 'assistant',
      content: 'I am an assistant.',
      agentId: 'agent-123',
    };

    await saveMessage(params);

    const retrievedMessage = await new Promise((resolve, reject) => {
      db.get(`SELECT * FROM conversations WHERE session_id = ?`, [params.sessionId], (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });

    expect(retrievedMessage).to.exist;
    expect(retrievedMessage.project).to.equal(params.project);
    expect(retrievedMessage.role).to.equal(params.role);
    expect(retrievedMessage.content).to.equal(params.content);
    expect(retrievedMessage.agent_id).to.equal(params.agentId);
    expect(embeddingStub.calledOnce).to.be.true;
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
    expect(embeddingStub.called).to.be.false; // Embedding should not be called if validation fails
  });

  it('should resolve true even if embedding generation fails, but message is saved', async () => {
    // Temporarily restore original generateEmbedding to control its behavior
    sinon.restore(); 
    sinon.stub(require('../src/services/embeddingService'), 'generateEmbedding').rejects(new Error('Embedding generation failed'));
    sinon.replace(require('../src/services/embeddingService'), 'saveEmbedding', sinon.stub().resolves(true));


    const params = {
      sessionId: uuidv4(),
      project: 'error-project',
      role: 'user',
      content: 'Message with embedding error',
    };

    const result = await saveMessage(params);
    expect(result).to.be.true; // Should still resolve true

    const retrievedMessage = await new Promise((resolve, reject) => {
      db.get(`SELECT * FROM conversations WHERE session_id = ?`, [params.sessionId], (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });
    expect(retrievedMessage).to.exist; // Message should still be in DB
  });
});