const { expect } = require('chai');
const sinon = require('sinon');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { createMcpServer } = require('../src/createMcpServer');
const llmClient = require('../src/services/llmClient');
const memoryAdapterService = require('../src/services/memoryAdapter');
const { db } = require('./test-helper');

function parseToolResult(result) {
  const text = result?.content?.find((item) => item.type === 'text')?.text;
  expect(text).to.be.a('string');
  return JSON.parse(text);
}

describe('Memory Audit MCP E2E', function () {
  this.timeout(15000);

  let client;
  let server;
  let sessionId;
  const project = `e2e-memory-audit-${Date.now()}`;

  beforeEach(async () => {
    server = createMcpServer();
    client = new Client({ name: 'memory-audit-e2e-test', version: '1.0.0' });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    sinon.stub(llmClient, 'generateText').callsFake(async (prompt) => {
      if (String(prompt).includes('JSON AUDIT')) {
        return JSON.stringify({
          status: 'missing',
          reason: 'No existe una memoria durable equivalente.',
          relatedMemoryIds: [],
        });
      }

      return JSON.stringify({
        candidates: [
          {
            type: 'decision',
            title: 'Usar PostgreSQL para el historial de conversaciones',
            what: 'PostgreSQL para almacenar el historial',
            why: 'Necesitamos persistencia y recuperación del historial',
            whereContext: 'conversation-memory-mcp',
            learned: '',
            importance: 'high',
            sourceMessageIds: [],
          },
        ],
      });
    });

    sinon.stub(memoryAdapterService, 'getMemoryAdapter').returns({
      provider: 'engram-local',
      getStatus: sinon.stub().resolves({ available: true, provider: 'engram-local', version: 'e2e-test' }),
      searchRelated: sinon.stub().resolves([]),
    });

    sessionId = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  });

  afterEach(async () => {
    sinon.restore();

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
      await db.runAsync('DELETE FROM conversations WHERE session_id = $1', [sessionId]);
    }

    try {
      await client.close();
    } finally {
      await server.close();
    }
  });

  it('recorre saveMessage -> finalizeSession -> memoryAudit sin escribir en Engram', async () => {
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
    expect(userMessageText).to.include('Mensaje guardado correctamente');

    const assistantMessage = await client.callTool({
      name: 'saveMessage',
      arguments: {
        sessionId,
        project,
        role: 'assistant',
        content: 'Queda registrado como decisión técnica del proyecto.',
        agentId: 'e2e-agent',
      },
    });

    expect(assistantMessage?.content?.find((item) => item.type === 'text')?.text)
      .to.include('Mensaje guardado correctamente');

    const finalized = parseToolResult(await client.callTool({
      name: 'finalizeSession',
      arguments: {
        sessionId,
        project,
        agentId: 'e2e-agent',
      },
    }));

    expect(finalized.sessionId).to.equal(sessionId);
    expect(finalized.summaryGenerated).to.equal(true);

    const audit = parseToolResult(await client.callTool({
      name: 'memoryAudit',
      arguments: {
        sessionId,
        project,
        agentId: 'e2e-agent',
      },
    }));

    expect(audit.sessionId).to.equal(sessionId);
    expect(audit.project).to.equal(project);
    expect(audit.memoryProvider.available).to.equal(true);
    expect(audit.candidates).to.have.lengthOf(1);
    expect(audit.candidates[0].status).to.equal('missing');
    expect(audit.candidates[0].promotable).to.equal(true);
    expect(memoryAdapterService.getMemoryAdapter().searchRelated.called).to.equal(true);
  });
});
