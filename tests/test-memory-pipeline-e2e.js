const { expect } = require('chai');
const sinon = require('sinon');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const llmClient = require('../src/services/llmClient');
const memoryAdapterService = require('../src/services/memoryAdapter');
const { db } = require('./test-helper');

function resetModules() {
  delete require.cache[require.resolve('../src/createMcpServer')];
  delete require.cache[require.resolve('../src/mcpTools')];
  delete require.cache[require.resolve('../src/tools/memoryAudit')];
  delete require.cache[require.resolve('../src/tools/memoryPromote')];
}

function parseToolResult(result) {
  const text = result?.content?.find((item) => item.type === 'text')?.text;
  expect(text).to.be.a('string');
  return JSON.parse(text);
}

describe('Memory pipeline MCP E2E', function () {
  this.timeout(15000);

  let client;
  let server;
  let sessionId;
  let adapter;
  let sourceMessageId;
  const project = `e2e-memory-pipeline-${Date.now()}`;

  beforeEach(async () => {
    resetModules();

    sinon.stub(llmClient, 'generateText').callsFake(async (prompt) => {
      const text = String(prompt);
      if (text.includes('JSON AUDIT')) {
        return JSON.stringify({
          status: 'missing',
          reason: 'No existe una memoria durable equivalente.',
          relatedMemoryIds: [],
        });
      }

      return JSON.stringify({
        candidates: [{
          type: 'decision',
          title: 'Usar PostgreSQL para el historial de conversaciones',
          what: 'PostgreSQL para almacenar el historial',
          why: 'Necesitamos persistencia y recuperación del historial',
          whereContext: 'conversation-memory-mcp',
          learned: 'La persistencia queda centralizada en Neon',
          importance: 'high',
          sourceMessageIds: sourceMessageId ? [sourceMessageId] : [],
        }],
      });
    });

    adapter = {
      provider: 'engram-local',
      getStatus: sinon.stub().resolves({
        available: true,
        provider: 'engram-local',
        version: 'e2e-test',
      }),
      searchRelated: sinon.stub().resolves([]),
      promote: sinon.stub().callsFake(async (candidate) => ({
        success: true,
        memoryId: `engram-${candidate.id}`,
        topicKey: 'postgres-history',
      })),
    };
    sinon.stub(memoryAdapterService, 'getMemoryAdapter').returns(adapter);

    const { createMcpServer } = require('../src/createMcpServer');
    server = createMcpServer();
    client = new Client({ name: 'memory-pipeline-e2e-test', version: '1.0.0' });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    sessionId = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  });

  afterEach(async () => {
    try {
      if (client) await client.close();
    } finally {
      if (server) await server.close();
      sinon.restore();
    }

    if (sessionId) {
      await db.runAsync('DELETE FROM memory_candidates WHERE session_id = $1', [sessionId]);
      await db.runAsync(
        'DELETE FROM message_embeddings WHERE message_id IN (SELECT id FROM conversations WHERE session_id = $1)',
        [sessionId]
      );
      await db.runAsync(
        'DELETE FROM embedding_failures WHERE message_id IN (SELECT id FROM conversations WHERE session_id = $1)',
        [sessionId]
      );
      await db.runAsync('DELETE FROM session_summaries WHERE session_id = $1', [sessionId]);
      await db.runAsync('DELETE FROM conversations WHERE session_id = $1', [sessionId]);
    }
  });

  it('recorre finalizeSession -> memoryAudit -> memoryPromote y mantiene la promoción idempotente', async () => {
    const userMessage = await client.callTool({
      name: 'saveMessage',
      arguments: {
        sessionId,
        project,
        role: 'user',
        content: 'Decidimos usar PostgreSQL para guardar el historial de conversaciones.',
        agentId: 'e2e-agent',
      },
    });

    const userMessageText = userMessage?.content?.find((item) => item.type === 'text')?.text || '';
    sourceMessageId = userMessageText.match(/ID:\s*(\S+)/)?.[1];
    expect(sourceMessageId).to.be.a('string');

    await client.callTool({
      name: 'saveMessage',
      arguments: {
        sessionId,
        project,
        role: 'assistant',
        content: 'Queda registrado como decisión técnica del proyecto.',
        agentId: 'e2e-agent',
        relatedMessageId: sourceMessageId,
      },
    });

    const finalized = parseToolResult(await client.callTool({
      name: 'finalizeSession',
      arguments: { sessionId, project, agentId: 'e2e-agent' },
    }));
    expect(finalized.summaryGenerated).to.equal(true);
    expect(finalized.auditRequired).to.equal(true);

    const audit = parseToolResult(await client.callTool({
      name: 'memoryAudit',
      arguments: { sessionId, project, agentId: 'e2e-agent' },
    }));
    expect(audit.candidates).to.have.lengthOf(1);
    expect(audit.candidates[0].status).to.equal('missing');
    expect(audit.candidates[0].promotable).to.equal(true);

    const candidateId = audit.candidates[0].candidateId;
    const promoted = parseToolResult(await client.callTool({
      name: 'memoryPromote',
      arguments: {
        sessionId,
        project,
        agentId: 'e2e-agent',
        candidateIds: [candidateId],
      },
    }));

    expect(promoted.results).to.deep.equal([{
      candidateId,
      status: 'promoted',
      memoryId: `engram-${candidateId}`,
    }]);
    expect(adapter.promote.calledOnce).to.equal(true);

    const promotedAgain = parseToolResult(await client.callTool({
      name: 'memoryPromote',
      arguments: {
        sessionId,
        project,
        agentId: 'e2e-agent',
        candidateIds: [candidateId],
      },
    }));

    expect(promotedAgain.results).to.deep.equal([{
      candidateId,
      status: 'already_promoted',
      memoryId: `engram-${candidateId}`,
    }]);
    expect(adapter.promote.calledOnce).to.equal(true);

    const row = await db.getAsync(
      'SELECT status, promoted_at, engram_id FROM memory_candidates WHERE id = $1',
      [candidateId]
    );
    expect(row.status).to.equal('missing');
    expect(row.promoted_at).to.not.equal(null);
    expect(row.engram_id).to.equal(`engram-${candidateId}`);
  });
});
