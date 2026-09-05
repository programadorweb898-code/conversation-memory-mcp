const { expect } = require('chai');
const sinon = require('sinon');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const extractMemories = require("../src/tools/extractMemories");
const { validateCandidate } = extractMemories;
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

  it('debería resolver GEMINI_API_KEY dinámicamente en cada llamada', async () => {
    testSessionId = `test-session-dinamica-${Date.now()}`;
    await saveMessage({ sessionId: testSessionId, project: "test", role: "user", content: "Decidimos usar postgres" });

    const getModelStub = GoogleGenerativeAI.prototype.getGenerativeModel;
    const originalKey = process.env.GEMINI_API_KEY;
    try {
      delete process.env.GEMINI_API_KEY;
      getModelStub.resetHistory();
      const sinKey = await extractMemories({ sessionId: testSessionId, project: "test" });
      expect(sinKey.candidates).to.be.an('array');
      expect(getModelStub.called).to.equal(false);

      process.env.GEMINI_API_KEY = 'clave-del-momento';
      getModelStub.resetHistory();
      const conKey = await extractMemories({ sessionId: testSessionId, project: "test" });
      expect(conKey.candidates).to.be.an('array');
      expect(getModelStub.calledOnce).to.equal(true);
    } finally {
      if (originalKey !== undefined) process.env.GEMINI_API_KEY = originalKey;
      else delete process.env.GEMINI_API_KEY;
    }
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

describe('Extract Memories — Validación de candidatos', () => {
  let validationSessionId;

  const validCandidate = {
    type: 'decision',
    title: 'decidimos usar postgres en neon',
    what: 'postgres en neon para el historial',
    why: 'desacoplar responsabilidades',
    whereContext: 'arquitectura',
    learned: 'consultar neon para el historial',
    importance: 'medium',
    sourceMessageIds: ['msg-1'],
  };

  afterEach(async () => {
    sinon.restore();
    try {
      if (validationSessionId) {
        await db.runAsync(`DELETE FROM message_embeddings WHERE message_id IN (SELECT id FROM conversations WHERE session_id = $1)`, [validationSessionId]);
        await db.runAsync(`DELETE FROM conversations WHERE session_id = $1`, [validationSessionId]);
      }
    } catch (err) {
      console.error("Error en limpieza de test de validación:", err.message);
    }
  });

  function expectInvalid(candidate, reason) {
    const result = validateCandidate(candidate);
    expect(result.valid).to.equal(false);
    if (reason !== undefined) expect(result.reason).to.equal(reason);
  }

  function expectValid(candidate) {
    expect(validateCandidate(candidate).valid).to.equal(true);
  }

  function without(candidate, keys) {
    const copy = { ...candidate };
    for (const key of keys) delete copy[key];
    return copy;
  }

  it('rechaza null', () => {
    expectInvalid(null);
  });

  it('rechaza un candidato que no es objeto', () => {
    expectInvalid('texto', 'Candidate is not an object');
    expectInvalid([validCandidate], 'Candidate is not an object');
  });

  it('rechaza type inválido', () => {
    expectInvalid({ ...validCandidate, type: 'raro' }, 'Invalid candidate type');
  });

  it('rechaza title vacío', () => {
    expectInvalid({ ...validCandidate, title: '' }, 'Candidate title is required');
  });

  it('rechaza title que solamente contiene espacios', () => {
    expectInvalid({ ...validCandidate, title: '   ' }, 'Candidate title is required');
  });

  it('rechaza title que no es string', () => {
    expectInvalid({ ...validCandidate, title: 123 }, 'Candidate title is required');
  });

  it('rechaza what vacío', () => {
    expectInvalid({ ...validCandidate, what: '' }, 'Candidate what is required');
  });

  it('rechaza what que solamente contiene espacios', () => {
    expectInvalid({ ...validCandidate, what: '   ' }, 'Candidate what is required');
  });

  it('rechaza sourceMessageIds ausente', () => {
    expectInvalid(without(validCandidate, ['sourceMessageIds']), 'Invalid sourceMessageIds');
  });

  it('rechaza sourceMessageIds que no es array', () => {
    expectInvalid({ ...validCandidate, sourceMessageIds: 'msg-1' }, 'Invalid sourceMessageIds');
  });

  it('rechaza sourceMessageIds vacío', () => {
    expectInvalid({ ...validCandidate, sourceMessageIds: [] }, 'At least one sourceMessageId is required');
  });

  it('rechaza sourceMessageIds con elementos inválidos', () => {
    expectInvalid({ ...validCandidate, sourceMessageIds: ['', 'msg-1'] }, 'Invalid sourceMessageIds');
    expectInvalid({ ...validCandidate, sourceMessageIds: [1] }, 'Invalid sourceMessageIds');
    expectInvalid({ ...validCandidate, sourceMessageIds: ['msg-1', ' '] }, 'Invalid sourceMessageIds');
  });

  it('rechaza importance inválida', () => {
    expectInvalid({ ...validCandidate, importance: 'urgente' }, 'Invalid importance');
  });

  it('rechaza title demasiado largo', () => {
    expectInvalid({ ...validCandidate, title: 'a'.repeat(201) }, 'Candidate title is too long');
  });

  it('rechaza what demasiado largo', () => {
    expectInvalid({ ...validCandidate, what: 'a'.repeat(2001) }, 'Candidate what is too long');
  });

  it('acepta un candidato completamente válido', () => {
    expectValid(validCandidate);
  });

  it('acepta candidato sin campos opcionales', () => {
    expectValid(without(validCandidate, ['why', 'whereContext', 'learned', 'importance']));
  });

  it('acepta candidato con why, whereContext y learned en null/undefined', () => {
    expectValid({ ...validCandidate, why: null, whereContext: undefined, learned: null });
  });

  it('acepta valores en el límite de longitud permitido', () => {
    expectValid({ ...validCandidate, title: 'a'.repeat(200), what: 'a'.repeat(2000) });
  });

  it('los candidatos rechazados no continúan al resultado final', async () => {
    validationSessionId = `test-val-${Date.now()}`;
    await saveMessage({ sessionId: validationSessionId, project: "test", role: "user", content: "Decidimos usar postgres" });

    const originalKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'test-key';

    sinon.stub(GoogleGenerativeAI.prototype, 'getGenerativeModel').returns({
      generateContent: sinon.stub().resolves({
        response: {
          text: () => JSON.stringify({
            candidates: [
              { type: 'decision', title: 'candidato válido', what: 'usar postgres', importance: 'high', sourceMessageIds: ['msg-x'] },
              { type: 'inventado', title: 'inv', what: 'x', sourceMessageIds: ['msg-x'] },
              { type: 'discovery', title: '   ', what: 'x', sourceMessageIds: ['msg-x'] },
              { type: 'lesson', title: 'inv', what: '', sourceMessageIds: ['msg-x'] },
              { type: 'constraint', title: 'inv', what: 'x', sourceMessageIds: [] },
              { type: 'configuration', title: 'inv', what: 'x', sourceMessageIds: ['msg-x'], importance: 'urgente' },
            ],
          }),
        },
      }),
    });

    try {
      const result = await extractMemories({ sessionId: validationSessionId, project: "test" });
      expect(result.candidates).to.have.lengthOf(1);
      expect(result.candidates[0].title).to.equal('candidato válido');
      expect(result.candidates[0].type).to.equal('decision');
    } finally {
      if (originalKey !== undefined) process.env.GEMINI_API_KEY = originalKey;
      else delete process.env.GEMINI_API_KEY;
    }
  });
});