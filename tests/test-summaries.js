/*
  Los tests de resumen usan un stub determinista del cliente LLM.
  No requieren una API key ni acceso a un proveedor externo.
*/
const { expect } = require('chai');
const sinon = require('sinon');
const llmClient = require('../src/services/llmClient');

const summaryFixture = JSON.stringify({
  goal: 'Generar un resumen de la conversación.',
  discoveries: ['La conversación contiene mensajes de prueba.'],
  accomplished: ['Se generó un resumen válido.'],
  next_steps: ['Continuar con la siguiente tarea.'],
});

const finalizeSession = require("../src/tools/finalizeSession");
const getSessionSummary = require("../src/tools/getSessionSummary");
const saveMessage = require("../src/tools/saveMessage");
const { db } = require('./test-helper');

describe('Session Summaries Tool', () => {
  const testSessionId = "test-session-summary-123";
  const testMessage1 = { sessionId: testSessionId, project: "test", role: "user", content: "Hola, ¿cómo estás?" };
  const testMessage2 = { sessionId: testSessionId, project: "test", role: "assistant", content: "Estoy bien, gracias. ¿En qué puedo ayudarte?" };
  const testMessage3 = { sessionId: testSessionId, project: "test", role: "user", content: "Necesito un resumen de esta conversación." };

  beforeEach(async () => {
    sinon.stub(llmClient, 'generateText').resolves(summaryFixture);

    try {
      await db.runAsync(`DELETE FROM conversations WHERE session_id = $1`, [testSessionId]);
      await db.runAsync(`DELETE FROM session_summaries WHERE session_id = $1`, [testSessionId]);
    } catch (err) {
      console.error("Error en limpieza inicial de test-summaries:", err.message);
    }

    await saveMessage(testMessage1);
    await saveMessage(testMessage2);
    await saveMessage(testMessage3);
  }).timeout(30000);

  afterEach(async () => {
    try {
      await db.runAsync(`DELETE FROM conversations WHERE session_id = $1`, [testSessionId]);
      await db.runAsync(`DELETE FROM session_summaries WHERE session_id = $1`, [testSessionId]);
    } catch (err) {
      console.error("Error en limpieza final de test-summaries:", err.message);
    } finally {
      sinon.restore();
    }
  }).timeout(30000);

  it('debería generar y guardar un resumen de sesión correctamente', async function() {
    this.timeout(30000);
    await finalizeSession({ sessionId: testSessionId, project: "test" });
    
    const result = await getSessionSummary({ sessionId: testSessionId, project: "test" });
    expect(result).to.exist;
    
    const parsedSummary = JSON.parse(result.summary);
    expect(parsedSummary).to.have.property('goal');
    expect(parsedSummary).to.have.property('discoveries');
    expect(parsedSummary).to.have.property('accomplished');
    expect(parsedSummary).to.have.property('next_steps');
    expect(result.timestamp).to.exist;
  });

  it('debería actualizar un resumen existente (upsert) con nuevo contenido', async function() {
    this.timeout(30000);
    await finalizeSession({ sessionId: testSessionId, project: "test" });
    
    const newMessage = { sessionId: testSessionId, project: "test", role: "assistant", content: "Entendido, estoy generando el resumen." };
    await saveMessage(newMessage);

    await finalizeSession({ sessionId: testSessionId, project: "test" });

    const result = await getSessionSummary({ sessionId: testSessionId, project: "test" });
    expect(result).to.exist;
    
    const parsedSummary = JSON.parse(result.summary);
    expect(parsedSummary).to.have.property('goal');
    expect(parsedSummary).to.have.property('discoveries');
    expect(parsedSummary).to.have.property('accomplished');
    expect(parsedSummary).to.have.property('next_steps');
  });

  it('no llama nuevamente al LLM cuando no hay mensajes nuevos', async function() {
    await finalizeSession({ sessionId: testSessionId, project: "test" });
    const callsAfterFirstFinalize = llmClient.generateText.callCount;

    const result = await finalizeSession({ sessionId: testSessionId, project: "test" });

    expect(llmClient.generateText.callCount).to.equal(callsAfterFirstFinalize);
    expect(result.summaryGenerated).to.equal(true);
    expect(result.auditRequired).to.equal(false);
    expect(result.summaryPending).to.equal(false);
  });

  it('procesa solo los mensajes posteriores al cursor del resumen', async function() {
    this.timeout(30000);
    await finalizeSession({ sessionId: testSessionId, project: "test" });
    const before = await db.getAsync(
      `SELECT last_processed_seq_id FROM session_summaries WHERE session_id = $1`,
      [testSessionId]
    );

    await saveMessage({
      sessionId: testSessionId,
      project: "test",
      role: "assistant",
      content: "Mensaje posterior al primer resumen.",
    });
    await finalizeSession({ sessionId: testSessionId, project: "test" });

    const after = await db.getAsync(
      `SELECT last_processed_seq_id FROM session_summaries WHERE session_id = $1`,
      [testSessionId]
    );

    expect(Number(after.last_processed_seq_id)).to.be.greaterThan(Number(before.last_processed_seq_id));
    expect(llmClient.generateText.callCount).to.equal(2);
    expect(llmClient.generateText.secondCall.args[0]).to.include("Mensaje posterior al primer resumen.");
    expect(llmClient.generateText.secondCall.args[0]).to.not.include("Hola, ¿cómo estás?");
  });

  it('mantiene el resumen y el cursor cuando el LLM no está disponible', async function() {
    await finalizeSession({ sessionId: testSessionId, project: "test" });
    const before = await db.getAsync(
      `SELECT summary, last_processed_seq_id FROM session_summaries WHERE session_id = $1`,
      [testSessionId]
    );

    await saveMessage({
      sessionId: testSessionId,
      project: "test",
      role: "assistant",
      content: "Mensaje pendiente de resumir.",
    });
    llmClient.generateText.rejects(new Error("LLM unavailable"));

    const result = await finalizeSession({ sessionId: testSessionId, project: "test" });
    const after = await db.getAsync(
      `SELECT summary, last_processed_seq_id FROM session_summaries WHERE session_id = $1`,
      [testSessionId]
    );

    expect(result.summaryGenerated).to.equal(false);
    expect(result.summaryPending).to.equal(true);
    expect(result.reason).to.equal("llm_unavailable");
    expect(after.summary).to.equal(before.summary);
    expect(Number(after.last_processed_seq_id)).to.equal(Number(before.last_processed_seq_id));
  });

  it('no expone un resumen a otro owner', async function() {
    const ownerA = "summary-owner-a";
    const ownerB = "summary-owner-b";
    const sessionId = `owner-summary-${Date.now()}`;

    await saveMessage({
      sessionId,
      project: "test",
      owner: ownerA,
      role: "user",
      content: "Dato privado del owner A",
    });
    await db.runAsync(
      `INSERT INTO session_summaries (session_id, project, owner, summary)
       VALUES ($1, $2, $3, $4)`,
      [sessionId, "test", ownerA, "Resumen privado A"]
    );

    const visibleToA = await getSessionSummary({ sessionId, project: "test", owner: ownerA });
    const visibleToB = await getSessionSummary({ sessionId, project: "test", owner: ownerB });

    expect(visibleToA.summary).to.equal("Resumen privado A");
    expect(visibleToB).to.equal(null);

    await db.runAsync(`DELETE FROM session_summaries WHERE session_id = $1`, [sessionId]);
    await db.runAsync(`DELETE FROM conversations WHERE session_id = $1`, [sessionId]);
  });
});
