const { expect } = require('chai');
const sinon = require('sinon');
const request = require('supertest');
const http = require('http');

const mcpSdk = require('@modelcontextprotocol/sdk/server/mcp.js');
const sseSdk = require('@modelcontextprotocol/sdk/server/sse.js');
const streamableHttpSdk = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const embeddingService = require('../src/services/embeddingService');

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

function openSse(server) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = http.get(
      {
        port,
        path: '/sse',
        headers: {
          authorization: 'Bearer test-token',
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

  it('should reject requests without token', async () => {
    const { app } = require('../src/server');
    const response = await request(app).get('/mcp');
    expect(response.status).to.equal(401);
  });

  it('should allow /health without token', async () => {
    const { app } = require('../src/server');
    const response = await request(app).get('/health');
    expect(response.status).to.equal(200);
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
