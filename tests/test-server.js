const { expect } = require('chai');
const sinon = require('sinon');
const request = require('supertest');
const http = require('http');

const mcpSdk = require('@modelcontextprotocol/sdk/server/mcp.js');
const sseSdk = require('@modelcontextprotocol/sdk/server/sse.js');
const streamableHttpSdk = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const embeddingService = require('../src/services/embeddingService');
const { db } = require('../src/database');
const { createApiKey } = require('../src/services/apiKeyService');
const { authLimiter, sseLimiter, messagesLimiter } = require('../src/middleware');

function resetServerModule() {
  delete require.cache[require.resolve('../src/server')];
  delete require.cache[require.resolve('../src/app')];
  delete require.cache[require.resolve('../src/routes')];
  delete require.cache[require.resolve('../src/createMcpServer')];
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    if (typeof server.close !== 'function') {
      reject(new TypeError('server.close is not a function'));
      return;
    }

    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }

    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function openSse(server, token = 'test-token') {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = http.get(
      {
        port,
        path: '/sse',
        headers: {
          authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        resolve({ req, res });
      }
    );

    req.on('error', reject);
  });
}

describe('Server HTTP layer', () => {
  let connectStub;
  let transportConstructorStub;
  let streamableTransportConstructorStub;
  let transportInstance;
  let httpServer;
  let sseConnection;
  let previousBearerToken;

  beforeEach(() => {
    resetServerModule();

    previousBearerToken = process.env.MCP_BEARER_TOKEN;
    process.env.MCP_BEARER_TOKEN = 'test-token';

    transportInstance = {
      response: null,
      close: sinon.stub(),
      handlePostMessage: sinon.stub().callsFake((req, res) => {
        res.status(200).json({ ok: true });
      }),
      handleRequest: sinon.stub().callsFake(async (req, res) => {
        res.status(200).json({ jsonrpc: '2.0', result: { ok: true } });
      }),
    };
    connectStub = sinon.stub().callsFake(async () => {
      if (transportInstance.response) {
        transportInstance.response.write(': connected\n\n');
      }
    });
    transportConstructorStub = sinon.stub().callsFake((path, res) => {
      transportInstance.response = res;
      return transportInstance;
    });
    streamableTransportConstructorStub = sinon.stub().callsFake(() => transportInstance);

    sinon.stub(mcpSdk, 'McpServer').callsFake(() => ({
      tool: sinon.stub(),
      connect: connectStub,
      close: sinon.stub(),
    }));
    sinon.stub(sseSdk, 'SSEServerTransport').callsFake(transportConstructorStub);
    sinon.stub(streamableHttpSdk, 'StreamableHTTPServerTransport').callsFake(streamableTransportConstructorStub);
    sinon.stub(embeddingService, 'initializeEmbeddingPipeline').resolves();
  });

  afterEach(async () => {
    if (sseConnection) {
      sseConnection.req.destroy();
      sseConnection.res.destroy();
      sseConnection = null;
    }

    if (httpServer) {
      await close(httpServer);
      httpServer = null;
    }

    if (previousBearerToken === undefined) {
      delete process.env.MCP_BEARER_TOKEN;
    } else {
      process.env.MCP_BEARER_TOKEN = previousBearerToken;
    }

    sinon.restore();
    resetServerModule();
  });

  it('should expose a working Express app and accept GET /sse', async () => {
    const { app } = require('../src/server');

    httpServer = await listen(app);
    sseConnection = await openSse(httpServer);

    expect(sseConnection.res.statusCode).to.equal(200);
    expect(sseConnection.res.headers['x-client-id']).to.be.a('string');
    expect(transportConstructorStub.calledOnce).to.be.true;
    expect(connectStub.calledOnce).to.be.true;
  });

  it('should reject POST /messages when the client is not registered', async () => {
    const { app } = require('../src/server');

    const response = await request(app)
      .post('/messages')
      .set('content-type', 'application/json')
      .set('authorization', 'Bearer test-token')
      .send({ hello: 'world' });

    expect(response.status).to.equal(400);
    expect(response.body).to.deep.equal({ error: 'Cliente no identificado o sesion expirada' });
  });

  it('should forward POST /messages to the transport for a registered client', async () => {
    const { app } = require('../src/server');

    httpServer = await listen(app);
    sseConnection = await openSse(httpServer);
    const clientId = sseConnection.res.headers['x-client-id'];

    const response = await request(httpServer)
      .post('/messages')
      .set('content-type', 'application/json')
      .set('authorization', 'Bearer test-token')
      .set('x-client-id', clientId)
      .send({ hello: 'world' });

    expect(response.status).to.equal(200);
    expect(transportInstance.handlePostMessage.calledOnce).to.be.true;
  });

  it('should reject an SSE session used with a different API key', async function () {
    this.timeout(30000);
    const owner = `sse-owner-${Date.now()}`;
    const first = await createApiKey({ name: `sse-key-a-${Date.now()}`, owner });
    const second = await createApiKey({ name: `sse-key-b-${Date.now()}`, owner });

    try {
      const { app } = require('../src/server');
      httpServer = await listen(app);
      sseConnection = await openSse(httpServer, first.token);
      const clientId = sseConnection.res.headers['x-client-id'];

      const response = await request(httpServer)
        .post('/messages')
        .set('content-type', 'application/json')
        .set('authorization', `Bearer ${second.token}`)
        .set('x-client-id', clientId)
        .send({ hello: 'world' });

      expect(response.status).to.equal(403);
      expect(transportInstance.handlePostMessage.called).to.be.false;
    } finally {
      await db.runAsync('DELETE FROM api_keys WHERE id = ANY($1)', [[first.key.id, second.key.id]]);
    }
  });

  it('should forward authenticated POST /mcp through the Streamable HTTP transport', async () => {
    const { app } = require('../src/server');

    const response = await request(app)
      .post('/mcp')
      .set('content-type', 'application/json')
      .set('authorization', 'Bearer test-token')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

    expect(response.status).to.equal(200);
    expect(response.body).to.deep.equal({ jsonrpc: '2.0', result: { ok: true } });
    expect(streamableTransportConstructorStub.calledOnce).to.equal(true);
    expect(connectStub.calledOnce).to.equal(true);
    expect(transportInstance.handleRequest.calledOnce).to.equal(true);
    expect(transportInstance.handleRequest.firstCall.args[0].method).to.equal('POST');
  });

  it('should not apply the SSE limit to authenticated /mcp requests', async () => {
    const { app } = require('../src/server');
    const clientIp = '198.51.100.77';
    sseLimiter.resetKey(clientIp);
    messagesLimiter.resetKey(clientIp);

    try {
      for (let requestNumber = 0; requestNumber < 11; requestNumber += 1) {
        const response = await request(app)
          .post('/mcp')
          .set('content-type', 'application/json')
          .set('authorization', 'Bearer test-token')
          .set('x-forwarded-for', clientIp)
          .send({ jsonrpc: '2.0', id: requestNumber, method: 'tools/list', params: {} });

        expect(response.status).to.equal(200);
      }
    } finally {
      sseLimiter.resetKey(clientIp);
      messagesLimiter.resetKey(clientIp);
    }
  });

  it('should give each owner an independent message limit across API keys on the same IP', async function () {
    this.timeout(30000);
    const { app } = require('../src/server');
    const ownerA = 'test-rate-limit-owner-a';
    const ownerB = 'test-rate-limit-owner-b';
    const keyNames = [
      'test-rate-limit-owner-a-key-1',
      'test-rate-limit-owner-a-key-2',
      'test-rate-limit-owner-b-key',
    ];
    const firstKey = await createApiKey({ name: keyNames[0], owner: ownerA });
    const secondKey = await createApiKey({ name: keyNames[1], owner: ownerA });
    const otherOwnerKey = await createApiKey({ name: keyNames[2], owner: ownerB });
    const clientIp = '198.51.100.78';
    messagesLimiter.resetKey(`owner:${ownerA}`);
    messagesLimiter.resetKey(`owner:${ownerB}`);

    try {
      for (let requestNumber = 0; requestNumber < 60; requestNumber += 1) {
        const response = await request(app)
          .post('/mcp')
          .set('content-type', 'application/json')
          .set('authorization', `Bearer ${firstKey.token}`)
          .set('x-forwarded-for', clientIp)
          .send({ jsonrpc: '2.0', id: requestNumber, method: 'tools/list', params: {} });

        expect(response.status).to.equal(200);
      }

      const sameOwnerResponse = await request(app)
        .post('/mcp')
        .set('content-type', 'application/json')
        .set('authorization', `Bearer ${secondKey.token}`)
        .set('x-forwarded-for', clientIp)
        .send({ jsonrpc: '2.0', id: 61, method: 'tools/list', params: {} });

      const otherOwnerResponse = await request(app)
        .post('/mcp')
        .set('content-type', 'application/json')
        .set('authorization', `Bearer ${otherOwnerKey.token}`)
        .set('x-forwarded-for', clientIp)
        .send({ jsonrpc: '2.0', id: 62, method: 'tools/list', params: {} });

      expect(sameOwnerResponse.status).to.equal(429);
      expect(otherOwnerResponse.status).to.equal(200);
    } finally {
      messagesLimiter.resetKey(`owner:${ownerA}`);
      messagesLimiter.resetKey(`owner:${ownerB}`);
      await db.runAsync('DELETE FROM api_keys WHERE name = ANY($1)', [keyNames]);
    }
  });

  it('should reject requests without token', async () => {
    const { app } = require('../src/server');
    const response = await request(app).get('/mcp');
    expect(response.status).to.equal(401);
  });

  it('should rate limit invalid-token requests before querying the database', async function () {
    this.timeout(30000);
    const { app } = require('../src/server');
    const clientIp = '198.51.100.79';
    const originalGetAsync = db.getAsync;
    let lookupCount = 0;

    authLimiter.resetKey(clientIp);

    db.getAsync = async (...args) => {
      lookupCount += 1;
      return originalGetAsync(...args);
    };

    try {
      for (let requestNumber = 0; requestNumber < 100; requestNumber += 1) {
        const response = await request(app)
          .get('/mcp')
          .set('authorization', 'Bearer invalid-token')
          .set('x-forwarded-for', clientIp);

        expect(response.status).to.equal(401);
      }

      expect(lookupCount).to.equal(100);

      const limitedResponse = await request(app)
        .get('/mcp')
        .set('authorization', 'Bearer invalid-token')
        .set('x-forwarded-for', clientIp);

      expect(limitedResponse.status).to.equal(429);
      expect(lookupCount).to.equal(100);
    } finally {
      db.getAsync = originalGetAsync;
      authLimiter.resetKey(clientIp);
    }
  });

  it('should allow /health without token', async () => {
    const { app } = require('../src/server');
    const response = await request(app).get('/health');
    expect(response.status).to.equal(200);
  });

  it('should report store metrics on /health without leaking project or owner names', async () => {
    const { app } = require('../src/server');
    const response = await request(app)
      .get('/health/details')
      .set('authorization', 'Bearer test-token');

    expect(response.status).to.equal(200);
    expect(response.body.status).to.equal('ok');
    expect(response.body.messages).to.have.property('total');
    expect(response.body.messages).to.have.property('coveragePct');
    expect(response.body.sessions).to.have.property('withoutSummary');
    expect(response.body).to.have.property('embeddingQueueSize');

    const serialized = JSON.stringify(response.body);
    expect(serialized).to.not.match(/local-user|test-owner|"project"/);
  });

  it('should require authentication for detailed health metrics', async () => {
    const { app } = require('../src/server');
    const response = await request(app).get('/health/details');
    expect(response.status).to.equal(401);
  });

  it('should return 503 when the public health database ping fails', async () => {
    const { db } = require('../src/database');
    sinon.stub(db, 'query').rejects(new Error('database unavailable'));
    const { app } = require('../src/server');

    const response = await request(app).get('/health');

    expect(response.status).to.equal(503);
    expect(response.body).to.deep.equal({ status: 'degraded', database: 'unreachable' });
  });

  it('should not count messages too short to embed as pending work on /health', async () => {
    const { getHealth } = require('../src/services/healthCheck');
    const { db } = require('../src/database');
    const { v4: uuidv4 } = require('uuid');

    const sessionId = `health-skipped-${uuidv4()}`;
    const id = uuidv4();
    await db.runAsync(
      `INSERT INTO conversations (id, session_id, project, role, content)
       VALUES ($1, $2, 'health-test', 'user', 'ok')`,
      [id, sessionId]
    );

    try {
      const health = await getHealth();
      expect(health.messages.pending).to.equal(0);
      expect(health.messages.skipped).to.be.at.least(1);
      expect(health.messages.total).to.be.at.least(1);
    } finally {
      await db.runAsync('DELETE FROM conversations WHERE id = $1', [id]);
    }
  });
});

describe('errorHandler', () => {
  it('should return a structured JSON error response', async () => {
    const express = require('express');
    const errorHandler = require('../src/errorHandler');

    const app = express();
    app.get('/boom', () => {
      throw Object.assign(new Error('boom'), { statusCode: 418 });
    });
    app.use(errorHandler);

    const response = await request(app).get('/boom');

    expect(response.status).to.equal(418);
    expect(response.body).to.deep.equal({
      status: 'error',
      statusCode: 418,
      message: 'boom',
    });
  });
});
