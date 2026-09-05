const { expect } = require('chai');
const sinon = require('sinon');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const extractMemories = require("../src/tools/extractMemories");
const saveMessage = require("../src/tools/saveMessage");
const { db } = require('./test-helper');

describe('Extract Memories Tool', () => {
  let testSessionId;

  beforeEach(() => {
    // Stub del LLM para que la recuperación y estructuración sea determinista
    // y no dependa de la quota de Gemini ni de servicios externos.
    sinon.stub(GoogleGenerativeAI.prototype, 'getGenerativeModel').returns({
      generateContent: sinon.stub().resolves({
        response: { text: () => JSON.stringify({ candidates: [] }) },
      }),
    });
  });

  afterEach(async () => {
    sinon.restore();
    try {
      if (testSessionId) {
        await db.runAsync(`DELETE FROM message_embeddings WHERE message_id IN (SELECT id FROM conversations WHERE session_id = $1)`, [testSessionId]);
        await db.runAsync(`DELETE FROM conversations WHERE session_id = $1`, [testSessionId]);
      }
    } catch (err) {
      console.error("Error en limpieza de test-extract-memories:", err.message);
    }
  });

  it('debería recuperar una sesión completa con la estructura esperada', async () => {
    testSessionId = `test-session-${Date.now()}`;

    await saveMessage({ sessionId: testSessionId, project: "test", role: "user", content: "Mensaje 1" });
    await saveMessage({ sessionId: testSessionId, project: "test", role: "assistant", content: "Mensaje 2" });

    const result = await extractMemories({ sessionId: testSessionId, project: "test" });

    expect(result).to.have.property('sessionId').that.equals(testSessionId);
    expect(result).to.have.property('project').that.equals("test");
    expect(result).to.have.property('messageCount').that.equals(2);
    expect(result).to.have.property('messages').that.is.an('array').with.lengthOf(2);
    expect(result).to.have.property('instructions');
    expect(result.instructions).to.have.property('memoryTypes');
    expect(result.instructions.memoryTypes).to.include.members([
      'decision', 'discovery', 'constraint', 'configuration', 'lesson',
    ]);
    expect(result).to.have.property('candidates').that.is.an('array');
    result.candidates.forEach((c) => {
      expect(c).to.have.property('type').that.is.oneOf([
        'decision', 'discovery', 'constraint', 'configuration', 'lesson',
      ]);
      expect(c).to.have.property('title').that.is.a('string');
      expect(c).to.have.property('what').that.is.a('string');
      expect(c).to.have.property('why').that.is.a('string');
      expect(c).to.have.property('whereContext').that.is.a('string');
      expect(c).to.have.property('learned').that.is.a('string');
      expect(c).to.have.property('importance').that.is.oneOf(['low', 'medium', 'high']);
      expect(c).to.have.property('sourceMessageIds').that.is.an('array');
    });
  });

  it('debería filtrar por project: una sesión de otro proyecto no debe devolver mensajes', async () => {
    testSessionId = `test-session-${Date.now()}`;

    // La sesión se guarda bajo el proyecto "test"
    await saveMessage({ sessionId: testSessionId, project: "test", role: "user", content: "Proyecto test" });

    // Al consultarla desde otro proyecto no debe devolver nada
    const result = await extractMemories({ sessionId: testSessionId, project: "otro" });

    expect(result.project).to.equal("otro");
    expect(result.messageCount).to.equal(0);
    expect(result.messages).to.have.lengthOf(0);
  });

  it('debería filtrar opcionalmente por agentId', async () => {
    testSessionId = `test-session-agent-${Date.now()}`;
    const agentId = 'agent-1';
    const otherAgentId = 'agent-2';

    await saveMessage({ sessionId: testSessionId, project: "test", role: "user", content: "Mensaje A1", agentId });
    await saveMessage({ sessionId: testSessionId, project: "test", role: "user", content: "Mensaje A2", agentId: otherAgentId });

    const result = await extractMemories({ sessionId: testSessionId, project: "test", agentId });

    expect(result.messageCount).to.equal(1);
    expect(result.messages[0].content).to.equal("Mensaje A1");
    expect(result.messages[0].agent_id).to.equal(agentId);
  });

  it('debería devolver una sesión vacía si no existe', async () => {
    const sessionId = `test-session-inexistente-${Date.now()}`;

    const result = await extractMemories({ sessionId, project: "test" });

    expect(result).to.have.property('sessionId').that.equals(sessionId);
    expect(result).to.have.property('project').that.equals("test");
    expect(result).to.have.property('messageCount').that.equals(0);
    expect(result).to.have.property('messages').that.is.an('array').with.lengthOf(0);
    expect(result).to.have.property('candidates').that.is.an('array').with.lengthOf(0);
  });

  it('debería devolver candidates sin lanzar error', async () => {
    testSessionId = `test-session-candidates-${Date.now()}`;

    await saveMessage({ sessionId: testSessionId, project: "test", role: "user", content: "Hola" });

    const result = await extractMemories({ sessionId: testSessionId, project: "test" });

    expect(result).to.have.property('candidates').that.is.an('array');
    // Sin resolver API key externa o si el contenido es trivial, puede quedar vacío,
    // pero nunca debe lanzar ni acoplarse a Engram.
  });

  it('debería lanzar error si falta el parámetro project', async () => {
    let error;
    try {
      await extractMemories({ sessionId: "abc", project: undefined });
    } catch (err) {
      error = err;
    }
    expect(error).to.be.an('error');
    expect(error.message).to.include('project');
  });
});