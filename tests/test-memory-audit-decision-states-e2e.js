const { expect } = require('chai');
const sinon = require('sinon');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const llmClient = require('../src/services/llmClient');
const memoryAdapterService = require('../src/services/memoryAdapter');
const { db } = require('./test-helper');

function resetMemoryAuditModules() {
  delete require.cache[require.resolve('../src/createMcpServer')];
  delete require.cache[require.resolve('../src/mcpTools')];
  delete require.cache[require.resolve('../src/tools/memoryAudit')];
}

function parseToolResult(result) {
  const text = result?.content?.find((item) => item.type === 'text')?.text;
  expect(text).to.be.a('string');
  return JSON.parse(text);
}

describe('Memory Audit decision states MCP E2E', function () {
  this.timeout(15000);

  let client;
  let server;
  let sessionId;
  let adapter;
  let sourceMessageId;
  const project = `e2e-memory-audit-states-${Date.now()}`;

  beforeEach(async () => {
    resetMemoryAuditModules();

    sinon.stub(llmClient, 'generateText').callsFake(async (prompt) => {
      const text = String(prompt);

      if (text.includes('JSON AUDIT')) {
        const title = text.match(/"title":\s*"([^"]+)"/)?.[1] || '';
        const statusByTitle = {
          'already-exists': 'already_exists',
          related: 'related',
          'possible-duplicate': 'possible_duplicate',
          conflict: 'conflict',
        };
        const status = Object.entries(statusByTitle).find(([key]) => title.includes(key))?.[1] || 'missing';

        return JSON.stringify({
          status,
          reason: `Estado E2E: ${status}`,
          relatedMemoryIds: status === 'missing' ? [] : ['engram-existing-1'],
        });
      }

      const title = text.includes('already-exists')
        ? 'already-exists'
        : text.includes('possible-duplicate')
          ? 'possible-duplicate'
          : text.includes('conflict')
            ? 'conflict'
            : 'related';

      return JSON.stringify({
        candidates: [{
          type: 'decision',
          title: `candidate-${title}`,
          what: 'Decisión técnica del proyecto',
          why: 'Necesitamos persistencia durable',
          whereContext: 'conversation-memory-mcp',
          learned: '',
          importance: 'high',
          sourceMessageIds: sourceMessageId ? [sourceMessageId] : [],
        }],
      });
    });

    adapter = {
      provider: 'engram-local',
      getStatus: sinon.stub().resolves({ available: true, provider: 'engram-local', version: 'e2e-test' }),
      searchRelated: sinon.stub().resolves([{
        id: 'engram-existing-1',
        type: 'decision',
        title: 'Decisión técnica existente',
        content: 'Decisión técnica relacionada con persistencia durable.',
        topicKey: 'technical-decisions',
      }]),
    };
    sinon.stub(memoryAdapterService, 'getMemoryAdapter').returns(adapter);

    const { createMcpServer } = require('../src/createMcpServer');
    server = createMcpServer();
    client = new Client({ name: 'memory-audit-decision-states-e2e', version: '1.0.0' });

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
      await db.runAsync('DELETE FROM conversations WHERE session_id = $1', [sessionId]);
    }
  });

  for (const expectedStatus of ['already_exists', 'related', 'possible_duplicate', 'conflict']) {
    it(`produce el estado ${expectedStatus} a través de saveMessage -> memoryAudit`, async () => {
      const marker = expectedStatus.replace('_', '-');

      const saved = await client.callTool({
        name: 'saveMessage',
        arguments: {
          sessionId,
          project,
          role: 'user',
          content: `Validar decisión ${marker}`,
          agentId: 'e2e-agent',
        },
      });

      const savedText = saved?.content?.find((item) => item.type === 'text')?.text || '';
      sourceMessageId = savedText.match(/ID:\s*(\S+)/)?.[1];
      expect(sourceMessageId).to.be.a('string');

      const audit = parseToolResult(await client.callTool({
        name: 'memoryAudit',
        arguments: {
          sessionId,
          project,
          agentId: 'e2e-agent',
        },
      }));

      expect(audit.sessionExists).to.equal(true);
      expect(audit.memoryProvider.available).to.equal(true);
      expect(audit.candidates).to.have.lengthOf(1);
      expect(audit.candidates[0].status).to.equal(expectedStatus);
      expect(audit.candidates[0].promotable).to.equal(false);
      expect(audit.candidates[0].relatedMemories).to.deep.equal([
        { id: 'engram-existing-1', topicKey: 'technical-decisions' },
      ]);
      expect(adapter.searchRelated.calledOnce).to.equal(true);
    });
  }
});
