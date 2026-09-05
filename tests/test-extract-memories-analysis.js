/*
  Tests de criterios de éxito de extractMemories.
  El LLM se stubea para que las pruebas sean deterministas, no consuman cuota ni
  dependan de servicios externos. Se verifica que la sesión se recupera de Neon,
  que el análisis produce candidatos estructurados con sourceMessageIds, y que
  NO hay acoplamiento a Engram ni persistencia en esta etapa.
*/
const { expect } = require('chai');
const sinon = require('sinon');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const extractMemories = require("../src/tools/extractMemories");
const saveMessage = require("../src/tools/saveMessage");
const { db } = require('./test-helper');

describe('Extract Memories — Criterios de éxito', () => {
  let sessionIds = [];

  function stubLlm(candidates) {
    const generateContentStub = sinon.stub().resolves({
      response: { text: () => JSON.stringify({ candidates }) },
    });
    sinon.stub(GoogleGenerativeAI.prototype, 'getGenerativeModel').returns({
      generateContent: generateContentStub,
    });
    return generateContentStub;
  }

  async function seedSession(pairs, extra = {}) {
    const sessionId = `crit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sessionIds.push(sessionId);
    const ids = [];
    for (const [role, content] of pairs) {
      const res = await saveMessage({ sessionId, project: "test", role, content, ...extra });
      ids.push(res.messageId);
    }
    return { sessionId, ids };
  }

  afterEach(async () => {
    sinon.restore();
    for (const sessionId of sessionIds) {
      try {
        await db.runAsync(`DELETE FROM message_embeddings WHERE message_id IN (SELECT id FROM conversations WHERE session_id = $1)`, [sessionId]);
        await db.runAsync(`DELETE FROM conversations WHERE session_id = $1`, [sessionId]);
      } catch (err) {
        console.error("Error en limpieza de test-extract-memories-analysis:", err.message);
      }
    }
    sessionIds = [];
  });

  it('Test 1 — detecta decisión arquitectónica (decision / high) con origen trazable', async () => {
    const { sessionId, ids } = await seedSession([
      ['user', 'Decidimos separar conversation-memory de Engram. Neon almacenará el historial y Engram la memoria semántica.'],
    ]);
    const stub = stubLlm([
      {
        type: 'decision',
        title: 'Separación conversation-memory y Engram',
        what: 'Neon guarda el historial y Engram la memoria semántica',
        why: 'Desacoplar responsabilidades',
        whereContext: 'Arquitectura del sistema de memoria',
        learned: 'Historial y memoria semántica tienen responsabilidades diferentes',
        importance: 'high',
        sourceMessageIds: [ids[0]],
      },
    ]);

    const result = await extractMemories({ sessionId, project: 'test' });

    expect(result.sessionExists).to.equal(true);
    expect(stub.calledOnce).to.be.true;
    expect(result.candidates).to.have.lengthOf(1);
    expect(result.candidates[0].type).to.equal('decision');
    expect(result.candidates[0].importance).to.equal('high');
    expect(result.candidates[0].sourceMessageIds).to.deep.equal([ids[0]]);
  });

  it('Test 2 — detecta configuración (configuration)', async () => {
    const { sessionId } = await seedSession([
      ['user', 'El proyecto utiliza PostgreSQL en Neon con pgvector y Render realiza el despliegue automático.'],
    ]);
    const stub = stubLlm([
      {
        type: 'configuration',
        title: 'Stack técnico del proyecto',
        what: 'PostgreSQL en Neon con pgvector y Render con despliegue automático',
        why: 'Define la infraestructura donde corre el sistema',
        whereContext: 'Infraestructura',
        learned: 'El stack tecnológico debe consultarse en la configuración del proyecto',
        importance: 'medium',
        sourceMessageIds: [],
      },
    ]);

    const result = await extractMemories({ sessionId, project: 'test' });

    expect(stub.calledOnce).to.be.true;
    expect(result.candidates).to.have.lengthOf(1);
    expect(result.candidates[0].type).to.equal('configuration');
  });

  it('Test 3 — detecta descubrimiento (discovery)', async () => {
    const { sessionId, ids } = await seedSession([
      ['assistant', 'Descubrimos que Engram devuelve unknown_project cuando se utiliza un proyecto que no reconoce.'],
    ]);
    const stub = stubLlm([
      {
        type: 'discovery',
        title: 'Engram devuelve unknown_project',
        what: 'Engram responde unknown_project con proyectos desconocidos',
        why: 'Afecta cómo se resuelven los proyectos contra Engram',
        whereContext: 'Engram',
        learned: 'Verificar el reconocimiento de proyecto antes de operar contra Engram',
        importance: 'medium',
        sourceMessageIds: [ids[0]],
      },
    ]);

    const result = await extractMemories({ sessionId, project: 'test' });

    expect(stub.calledOnce).to.be.true;
    expect(result.candidates[0].type).to.equal('discovery');
    expect(result.candidates[0].sourceMessageIds).to.deep.equal([ids[0]]);
  });

  it('Test 4 — detecta lección aprendida (lesson)', async () => {
    const { sessionId, ids } = await seedSession([
      ['user', 'El problema ocurría porque estábamos guardando el valor incorrecto. La solución fue utilizar la configuración del entorno en lugar de hardcodearla.'],
    ]);
    stubLlm([
      {
        type: 'lesson',
        title: 'Usar configuración de entorno en vez de valores hardcodeados',
        what: 'Un valor incorrecto hardcodeado causaba fallos',
        why: 'La configuración de entorno es la fuente correcta de configuración',
        whereContext: 'Desarrollo',
        learned: 'No hardcodear valores configurables',
        importance: 'high',
        sourceMessageIds: [ids[0]],
      },
    ]);

    const result = await extractMemories({ sessionId, project: 'test' });

    expect(result.candidates[0].type).to.equal('lesson');
    expect(result.candidates[0].importance).to.be.oneOf(['low', 'medium', 'high']);
  });

  it('Test 5 — detecta restricción (constraint)', async () => {
    const { sessionId, ids } = await seedSession([
      ['assistant', 'Las credenciales y secretos nunca deben almacenarse directamente en el código.'],
    ]);
    stubLlm([
      {
        type: 'constraint',
        title: 'No almacenar secretos en código',
        what: 'Credenciales y secretos no deben ir en el código fuente',
        why: 'Evita fugas de credenciales y problemas de seguridad',
        whereContext: 'Seguridad',
        learned: 'Usar variables de entorno o gestores de secretos',
        importance: 'high',
        sourceMessageIds: [ids[0]],
      },
    ]);

    const result = await extractMemories({ sessionId, project: 'test' });

    expect(result.candidates[0].type).to.equal('constraint');
    expect(result.candidates[0].importance).to.equal('high');
  });

  it('Test 6 — conversación trivial produce un LLM que no genera memorias artificiales (candidates: [])', async () => {
    const { sessionId } = await seedSession([
      ['user', 'Hola.'],
      ['user', '¿Cómo estás?'],
      ['user', 'Bien, seguimos con el proyecto.'],
    ]);
    const stub = stubLlm([]);

    const result = await extractMemories({ sessionId, project: 'test' });

    // El LLM SÍ se consultó (se analizó la conversación), pero decidió no extraer nada.
    expect(stub.calledOnce).to.be.true;
    expect(result.candidates).to.deep.equal([]);
  });

  it('Test 7 — sesión inexistente: respuesta controlada y clara, sin error no controlado', async () => {
    const stub = stubLlm([]);
    const sessionId = `crit-inexistente-${Date.now()}`;

    let error = null;
    let result;
    try {
      result = await extractMemories({ sessionId, project: 'test' });
    } catch (err) {
      error = err;
    }

    expect(error).to.be.null;
    expect(result).to.exist;
    expect(result.sessionExists).to.equal(false);
    expect(result.messageCount).to.equal(0);
    expect(result.messages).to.deep.equal([]);
    expect(result.candidates).to.deep.equal([]);
    // No se desperdicia una llamada LLM sin mensajes que analizar.
    expect(stub.called).to.equal(false);
  });

  it('Test 8 — respeta agentId: analiza únicamente los mensajes del agente solicitado', async () => {
    const { sessionId, ids } = await seedSession([
      ['user', 'Mensaje del agente A'],
    ], { agentId: 'agent-a' });
    await saveMessage({ sessionId, project: "test", role: "user", content: "Mensaje del agente B", agentId: 'agent-b' });

    const generateContentStub = sinon.stub().callsFake((prompt) => ({
      response: {
        text: () => JSON.stringify({
          candidates: [
            {
              type: 'discovery',
              title: 'Hallazgo del agente A',
              what: 'Contenido del agente A',
              why: 'Relevante',
              whereContext: 'Contexto',
              learned: 'Aprendizaje',
              importance: 'medium',
              sourceMessageIds: [ids[0]],
            },
          ],
        }),
      },
    }));
    sinon.stub(GoogleGenerativeAI.prototype, 'getGenerativeModel').returns({
      generateContent: generateContentStub,
    });

    const result = await extractMemories({ sessionId, project: 'test', agentId: 'agent-a' });

    expect(result.messageCount).to.equal(1);
    expect(result.messages[0].agent_id).to.equal('agent-a');

    // El prompt solo contiene los mensajes del agente A.
    const prompt = generateContentStub.getCall(0).args[0];
    expect(prompt).to.contain('Mensaje del agente A');
    expect(prompt).to.not.contain('Mensaje del agente B');
  });

  it('Test 9 — sin Engram: funciona, devuelve candidatos y no persiste nada', async () => {
    const { sessionId, ids } = await seedSession([
      ['user', 'Decisión de arquitectura con valor futuro'],
    ]);
    const stub = stubLlm([
      {
        type: 'decision',
        title: 'Decisión de arquitectura',
        what: 'Se adoptó una decisión',
        why: 'Por motivos de diseño',
        whereContext: 'Arquitectura',
        learned: 'Imprescindible para decisiones futuras',
        importance: 'high',
        sourceMessageIds: [ids[0]],
      },
    ]);

    const before = await db.getAsync(
      'SELECT (SELECT COUNT(*) FROM conversations WHERE session_id=$1) AS conversations, (SELECT COUNT(*) FROM message_embeddings WHERE message_id IN (SELECT id FROM conversations WHERE session_id=$1)) AS embeddings, (SELECT COUNT(*) FROM session_summaries WHERE session_id=$1) AS summaries',
      [sessionId]
    );

    const result = await extractMemories({ sessionId, project: 'test' });

    const after = await db.getAsync(
      'SELECT (SELECT COUNT(*) FROM conversations WHERE session_id=$1) AS conversations, (SELECT COUNT(*) FROM message_embeddings WHERE message_id IN (SELECT id FROM conversations WHERE session_id=$1)) AS embeddings, (SELECT COUNT(*) FROM session_summaries WHERE session_id=$1) AS summaries',
      [sessionId]
    );

    expect(stub.calledOnce).to.be.true;
    expect(result.candidates).to.have.lengthOf(1);
    expect(result.candidates[0].sourceMessageIds).to.deep.equal([ids[0]]);
    // No hay escritura de ninguna naturaleza (los conteos de pg vienen como string).
    expect(Number(after.conversations)).to.equal(Number(before.conversations));
    expect(Number(after.embeddings)).to.equal(Number(before.embeddings));
    expect(Number(after.summaries)).to.equal(Number(before.summaries));
    // La respuesta no expone nada del mecanismo de Engram.
    expect(JSON.stringify(result).toLowerCase()).to.not.contain('engram');
  });

  it('Test 10 — repetición: mismo conjunto de candidatos, sin duplicados en persistencia', async () => {
    const { sessionId, ids } = await seedSession([
      ['user', 'Configuración de infraestructura relevante'],
    ]);
    const stub = stubLlm([
      {
        type: 'configuration',
        title: 'Configuración de infraestructura',
        what: 'Infraestructura configurada',
        why: 'Necesaria para el despliegue',
        whereContext: 'Infraestructura',
        learned: 'Consulta la configuración vigente',
        importance: 'medium',
        sourceMessageIds: [ids[0]],
      },
    ]);

    const first = await extractMemories({ sessionId, project: 'test' });
    const second = await extractMemories({ sessionId, project: 'test' });

    // Mismo conjunto lógico de candidatos en ambas ejecuciones.
    expect(second.candidates).to.deep.equal(first.candidates);
    expect(second.sessionId).to.equal(first.sessionId);
    expect(second.project).to.equal(first.project);

    // La ejecución repetida no agregó filas a ninguna tabla.
    const conversations = await db.getAsync('SELECT COUNT(*) AS c FROM conversations WHERE session_id=$1', [sessionId]);
    const summaries = await db.getAsync('SELECT COUNT(*) AS c FROM session_summaries WHERE session_id=$1', [sessionId]);
    const embeddings = await db.getAsync('SELECT COUNT(*) AS c FROM message_embeddings WHERE message_id IN (SELECT id FROM conversations WHERE session_id=$1)', [sessionId]);
    expect(Number(conversations.c)).to.equal(1);
    expect(Number(summaries.c)).to.equal(0);
    expect(Number(embeddings.c)).to.equal(0);
    expect(stub.calledTwice).to.be.true;
  });
});