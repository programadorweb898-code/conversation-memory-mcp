const { expect } = require('chai');
const sinon = require('sinon');
const { v4: uuidv4 } = require('uuid');

const { db } = require('./test-helper');
const saveMessage = require('../src/tools/saveMessage');
const saveMessagePair = require('../src/tools/saveMessagePair');
const recoverSession = require('../src/tools/recoverSession');

describe('saveMessagePair', () => {
  let queueStub;
  const testSessionIds = [];

  beforeEach(() => {
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
        console.error("Error en limpieza de test-save-message-pair:", err.message);
      }
    }
    testSessionIds.length = 0;
  });

  function newSession() {
    const sessionId = uuidv4();
    testSessionIds.push(sessionId);
    return sessionId;
  }

  it('guarda el turno completo y vincula la respuesta con el mensaje del usuario', async () => {
    const sessionId = newSession();

    const result = await saveMessagePair({
      sessionId,
      project: 'test-project-pair',
      agentId: 'opencode',
      userContent: '¿Cómo corro los tests?',
      assistantContent: 'Con npm test.',
    });

    expect(result.skipped).to.equal(false);
    expect(result.userMessageId).to.be.a('string');
    expect(result.assistantMessageId).to.be.a('string');
    expect(result.assistantMessageId).to.not.equal(result.userMessageId);

    const rows = await db.allAsync(
      `SELECT id, role, content, agent_id, related_message_id FROM conversations WHERE session_id = $1 ORDER BY sequence_id ASC`,
      [sessionId]
    );

    expect(rows).to.have.length(2);
    expect(rows[0].id).to.equal(result.userMessageId);
    expect(rows[0].role).to.equal('user');
    expect(rows[0].content).to.equal('¿Cómo corro los tests?');
    expect(rows[1].id).to.equal(result.assistantMessageId);
    expect(rows[1].role).to.equal('assistant');
    expect(rows[1].content).to.equal('Con npm test.');
    expect(rows[1].related_message_id).to.equal(result.userMessageId);
    expect(rows[0].agent_id).to.equal('opencode');
    expect(rows[1].agent_id).to.equal('opencode');
  });

  it('devuelve el turno en orden cronológico al recuperar la sesión', async () => {
    const sessionId = newSession();

    await saveMessagePair({
      sessionId,
      project: 'test-project-pair',
      userContent: 'primera pregunta',
      assistantContent: 'primera respuesta',
    });

    const messages = await recoverSession({ sessionId, project: 'test-project-pair' });

    expect(messages.map((m) => m.role)).to.deep.equal(['user', 'assistant']);
    expect(messages.map((m) => m.content)).to.deep.equal(['primera pregunta', 'primera respuesta']);
  });

  it('no duplica el turno cuando se reintenta con los mismos sourceMessageId', async () => {
    const sessionId = newSession();
    const params = {
      sessionId,
      project: 'test-project-pair',
      userContent: 'pregunta',
      assistantContent: 'respuesta',
      userSourceMessageId: 'msg_user_1',
      assistantSourceMessageId: 'msg_assistant_1',
    };

    const first = await saveMessagePair(params);
    const second = await saveMessagePair(params);

    expect(second.userMessageId).to.equal(first.userMessageId);
    expect(second.assistantMessageId).to.equal(first.assistantMessageId);

    const rows = await db.allAsync(`SELECT id FROM conversations WHERE session_id = $1`, [sessionId]);
    expect(rows).to.have.length(2);
  });

  it('descarta el turno cuando el mensaje del usuario es ruido de protocolo MCP', async () => {
    const sessionId = newSession();

    const result = await saveMessagePair({
      sessionId,
      project: 'test-project-pair',
      userContent: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list' }),
      assistantContent: 'respuesta que no debe guardarse sola',
    });

    expect(result.skipped).to.equal(true);
    expect(result.userMessageId).to.be.null;
    expect(result.assistantMessageId).to.be.null;

    const rows = await db.allAsync(`SELECT id FROM conversations WHERE session_id = $1`, [sessionId]);
    expect(rows).to.have.length(0);
  });

  it('rechaza un project que es una ruta', async () => {
    const sessionId = newSession();

    let error;
    try {
      await saveMessagePair({
        sessionId,
        project: 'C:\\repos\\proyecto',
        userContent: 'pregunta',
        assistantContent: 'respuesta',
      });
    } catch (err) {
      error = err;
    }

    expect(error).to.exist;
    expect(error.code).to.equal('INVALID_PROJECT');
  });

  it('rechaza el turno si la sesión ya pertenece a otro proyecto', async () => {
    const sessionId = newSession();

    await saveMessage({
      sessionId,
      project: 'test-project-pair-original',
      role: 'user',
      content: 'mensaje previo',
    });

    let error;
    try {
      await saveMessagePair({
        sessionId,
        project: 'test-project-pair',
        userContent: 'pregunta',
        assistantContent: 'respuesta',
      });
    } catch (err) {
      error = err;
    }

    expect(error).to.exist;
    expect(error.code).to.equal('SESSION_UNAVAILABLE');
  });

  it('informa el guardado parcial y permite completar el turno en un reintento', async () => {
    const sessionId = newSession();

    // Un mensaje previo con el mismo sourceMessageId pero otro contenido hace
    // fallar la segunda escritura después de que la primera ya se persistió.
    await saveMessage({
      sessionId,
      project: 'test-project-pair',
      role: 'assistant',
      content: 'contenido viejo',
      sourceMessageId: 'assistant_conflict',
    });

    let error;
    try {
      await saveMessagePair({
        sessionId,
        project: 'test-project-pair',
        userContent: 'pregunta que sí se guarda',
        assistantContent: 'respuesta que falla',
        userSourceMessageId: 'user_stable_1',
        assistantSourceMessageId: 'assistant_conflict',
      });
    } catch (err) {
      error = err;
    }

    expect(error).to.exist;
    expect(error.code).to.equal('PAIR_PARTIAL_SAVE');
    expect(error.userMessageId).to.be.a('string');

    const afterFailure = await db.allAsync(
      `SELECT role FROM conversations WHERE session_id = $1 ORDER BY sequence_id ASC`,
      [sessionId]
    );
    expect(afterFailure.map((r) => r.role)).to.deep.equal(['assistant', 'user']);

    // El reintento reutiliza el mensaje del usuario ya guardado.
    const retry = await saveMessagePair({
      sessionId,
      project: 'test-project-pair',
      userContent: 'pregunta que sí se guarda',
      assistantContent: 'respuesta correcta',
      userSourceMessageId: 'user_stable_1',
      assistantSourceMessageId: 'assistant_stable_1',
    });

    expect(retry.userMessageId).to.equal(error.userMessageId);

    const finalRows = await db.allAsync(
      `SELECT role, content, related_message_id FROM conversations WHERE session_id = $1 AND project = $2 ORDER BY sequence_id ASC`,
      [sessionId, 'test-project-pair']
    );
    const userRows = finalRows.filter((r) => r.role === 'user');
    expect(userRows).to.have.length(1);
    expect(finalRows.some((r) => r.content === 'respuesta correcta' && r.related_message_id === retry.userMessageId)).to.equal(true);
  });
});
