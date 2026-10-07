const { expect } = require('chai');
const sinon = require('sinon');
const request = require('supertest');
const http = require('http');

const mcpSdk = require('@modelcontextprotocol/sdk/server/mcp.js');
const sseSdk = require('@modelcontextprotocol/sdk/server/sse.js');
const streamableHttpSdk = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const embeddingService = require('../src/services/embeddingService');
const embeddingWorker = require('../src/services/embeddingWorker');
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
  let serverCloseStub;
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
    serverCloseStub = sinon.stub();

    sinon.stub(mcpSdk, 'McpServer').callsFake(() => ({
      tool: sinon.stub(),
      connect: connectStub,
      close: serverCloseStub,
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

    if (httpServer?.listening) {
      await close(httpServer);
    }
    httpServer = null;

    if (previousBearerToken === undefined) {
      delete process.env.MCP_BEARER_TOKEN;
    } else {
      process.env.MCP_BEARER_TOKEN = previousBearerToken;
    }

    sinon.restore();
    resetServerModule();
  });

  it('should shut down HTTP, worker and database in order and be idempotent', async function () {
    this.timeout(10000);
    const previousPort = process.env.PORT;
    const previousWorkerSetting = process.env.ENABLE_EMBEDDING_WORKER;
    process.env.PORT = '0';
    process.env.ENABLE_EMBEDDING_WORKER = 'false';
    const order = [];
    const stopWorkerStub = sinon.stub(embeddingWorker, 'stopWorker').callsFake(async () => order.push('worker'));
    const dbCloseStub = sinon.stub(db, 'close').callsFake(async () => order.push('db'));
    const exitStub = sinon.stub(process, 'exit');
    try {
      const { startServer, shutdown } = require('../src/server');
      httpServer = await startServer();
      const realClose = httpServer.close.bind(httpServer);
      sinon.stub(httpServer, 'close').callsFake((callback) => { order.push('http'); return realClose(callback); });
      const firstShutdown = shutdown('SIGTERM');
      const secondShutdown = shutdown('SIGTERM');
      expect(secondShutdown).to.equal(firstShutdown);
      await firstShutdown;
      expect(order).to.deep.equal(['http', 'worker', 'db']);
      expect(stopWorkerStub.calledOnce).to.be.true;
      expect(dbCloseStub.calledOnce).to.be.true;
      expect(exitStub.calledOnceWithExactly(143)).to.be.true;
    } finally {
      if (previousPort === undefined) delete process.env.PORT; else process.env.PORT = previousPort;
      if (previousWorkerSetting === undefined) delete process.env.ENABLE_EMBEDDING_WORKER; else process.env.ENABLE_EMBEDDING_WORKER = previousWorkerSetting;
    }
  });

  it('should close active SSE transports before completing HTTP shutdown', async function () {
    this.timeout(10000);
    const previousPort = process.env.PORT;
    const previousWorkerSetting = process.env.ENABLE_EMBEDDING_WORKER;
    process.env.PORT = '0';
    process.env.ENABLE_EMBEDDING_WORKER = 'false';
    const stopWorkerStub = sinon.stub(embeddingWorker, 'stopWorker').resolves();
    const dbCloseStub = sinon.stub(db, 'close').resolves();
    const exitStub = sinon.stub(process, 'exit');
    transportInstance.close.callsFake(async () => { transportInstance.response?.end(); });
    try {
      const { startServer, shutdown } = require('../src/server');
      httpServer = await startServer();      sseConnection = await openSse(httpServer);
      await shutdown('SIGTERM');
      expect(transportInstance.close.calledOnce).to.be.true;
      expect(stopWorkerStub.calledOnce).to.be.true;
      expect(dbCloseStub.calledOnce).to.be.true;
      expect(exitStub.calledOnceWithExactly(143)).to.be.true;
    } finally {
      if (previousPort === undefined) delete process.env.PORT; else process.env.PORT = previousPort;
      if (previousWorkerSetting === undefined) delete process.env.ENABLE_EMBEDDING_WORKER; else process.env.ENABLE_EMBEDDING_WORKER = previousWorkerSetting;
    }
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

  it('should close the SSE MCP server exactly once when the client disconnects', async () => {
    const { app } = require('../src/server');

    httpServer = await listen(app);
    sseConnection = await openSse(httpServer);

    sseConnection.req.destroy();
    sseConnection.res.destroy();

    await new Promise((resolve) => setImmediate(resolve));

    expect(serverCloseStub.calledOnce).to.be.true;
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

  it('should reject a disallowed MCP host before authentication', async () => {
    const { app } = require('../src/server');
    const previousHosts = process.env.MCP_ALLOWED_HOSTS;

    process.env.MCP_ALLOWED_HOSTS = 'allowed.example';

    try {      const response = await request(app)
        .get('/mcp')
        .set('host', 'attacker.example')
        .set('authorization', 'Bearer test-token');

      expect(response.status).to.equal(403);
      expect(response.body).to.deep.equal({ error: 'Host no autorizado.' });
    } finally {
      if (previousHosts === undefined) {
        delete process.env.MCP_ALLOWED_HOSTS;
      } else {
        process.env.MCP_ALLOWED_HOSTS = previousHosts;
      }
    }
  });

  it('should accept an allowed MCP host and origin', async () => {
    const { app } = require('../src/server');
    const previousHosts = process.env.MCP_ALLOWED_HOSTS;
    const previousOrigins = process.env.MCP_ALLOWED_ORIGINS;

    process.env.MCP_ALLOWED_HOSTS = 'allowed.example';
    process.env.MCP_ALLOWED_ORIGINS = 'https://allowed.example';

    try {
      const response = await request(app)
        .post('/mcp')
        .set('host', 'allowed.example')
        .set('origin', 'https://allowed.example/')
        .set('content-type', 'application/json')
        .set('authorization', 'Bearer test-token')
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

      expect(response.status).to.equal(200);
    } finally {
      if (previousHosts === undefined) {
        delete process.env.MCP_ALLOWED_HOSTS;
      } else {
        process.env.MCP_ALLOWED_HOSTS = previousHosts;
      }

      if (previousOrigins === undefined) {
        delete process.env.MCP_ALLOWED_ORIGINS;
      } else {
        process.env.MCP_ALLOWED_ORIGINS = previousOrigins;
      }
    }
  });

  it('should reject a disallowed MCP origin', async () => {
    const { app } = require('../src/server');
    const previousHosts = process.env.MCP_ALLOWED_HOSTS;
    const previousOrigins = process.env.MCP_ALLOWED_ORIGINS;

    process.env.MCP_ALLOWED_HOSTS = 'allowed.example';
    process.env.MCP_ALLOWED_ORIGINS = 'https://allowed.example';

    try {
      const response = await request(app)
        .post('/mcp')
        .set('host', 'allowed.example')
        .set('origin', 'https://attacker.example')
        .set('content-type', 'application/json')
        .set('authorization', 'Bearer test-token')
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

      expect(response.status).to.equal(403);
      expect(response.body).to.deep.equal({ error: 'Origin no autorizado.' });
    } finally {
      if (previousHosts === undefined) {
        delete process.env.MCP_ALLOWED_HOSTS;
      } else {
        process.env.MCP_ALLOWED_HOSTS = previousHosts;
      }

      if (previousOrigins === undefined) {
        delete process.env.MCP_ALLOWED_ORIGINS;
      } else {
        process.env.MCP_ALLOWED_ORIGINS = previousOrigins;
      }
    }
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

  it('should scope detailed health metrics to the authenticated owner', async function () {
    this.timeout(30000);
    const { app } = require('../src/server');
    const ownerA = `health-owner-a-${Date.now()}`;
    const ownerB = `health-owner-b-${Date.now()}`;
    const firstKey = await createApiKey({ name: `health-key-a-${Date.now()}`, owner: ownerA });
    const secondKey = await createApiKey({ name: `health-key-b-${Date.now()}`, owner: ownerB });
    const messageA = `health-message-a-${Date.now()}`;
    const messageB = `health-message-b-${Date.now()}`;

    await db.runAsync(
      `INSERT INTO conversations (id, session_id, project, role, content, owner)
       VALUES ($1, $2, 'health-test', 'user', $3, $4)`,
      [messageA, `health-session-a-${Date.now()}`, 'This message belongs only to owner A and must not be visible to owner B.', ownerA]
    );
    await db.runAsync(
      `INSERT INTO conversations (id, session_id, project, role, content, owner)
       VALUES ($1, $2, 'health-test', 'user', $3, $4)`,
      [messageB, `health-session-b-${Date.now()}`, 'This message belongs only to owner B and must not be visible to owner A.', ownerB]
    );

    try {
      const firstResponse = await request(app)
        .get('/health/details')
        .set('authorization', `Bearer ${firstKey.token}`);

      const secondResponse = await request(app)
        .get('/health/details')
        .set('authorization', `Bearer ${secondKey.token}`);

      expect(firstResponse.status).to.equal(200);
      expect(secondResponse.status).to.equal(200);
      expect(firstResponse.body.messages.total).to.equal(1);
      expect(secondResponse.body.messages.total).to.equal(1);
      expect(firstResponse.body.sessions.total).to.equal(1);
      expect(secondResponse.body.sessions.total).to.equal(1);
      expect(firstResponse.body.embeddingQueueSize).to.equal(null);
      expect(secondResponse.body.embeddingQueueSize).to.equal(null);
    } finally {
      await db.runAsync('DELETE FROM conversations WHERE id = ANY($1)', [[messageA, messageB]]);
      await db.runAsync('DELETE FROM api_keys WHERE id = ANY($1)', [[firstKey.key.id, secondKey.key.id]]);
    }
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