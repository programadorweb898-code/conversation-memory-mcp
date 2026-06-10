const { expect } = require('chai');
const sinon = require('sinon');
const request = require('supertest');
const http = require('http');

const mcpSdk = require('@modelcontextprotocol/sdk/server/mcp.js');
const sseSdk = require('@modelcontextprotocol/sdk/server/sse.js');
const embeddingService = require('../src/services/embeddingService');

function resetServerModule() {
  delete require.cache[require.resolve('../src/server')];
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
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
  let transportInstance;
  let httpServer;
  let sseConnection;

  beforeEach(() => {
    resetServerModule();

    transportInstance = {
      response: null,
      handlePostMessage: sinon.stub().callsFake((req, res) => {
        res.status(200).json({ ok: true });
      }),
    };
    connectStub = sinon.stub().callsFake(async () => {
      transportInstance.response.write(': connected\n\n');
    });
    transportConstructorStub = sinon.stub().callsFake((path, res) => {
      transportInstance.response = res;
      return transportInstance;
    });

    sinon.stub(mcpSdk, 'McpServer').callsFake(() => ({
      tool: sinon.stub(),
      connect: connectStub,
    }));
    sinon.stub(sseSdk, 'SSEServerTransport').callsFake(transportConstructorStub);
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
      .send({ hello: 'world' });

    expect(response.status).to.equal(400);
    expect(response.body).to.deep.equal({ error: 'Cliente no identificado o sesión expirada' });
  });

  it('should forward POST /messages to the transport for a registered client', async () => {
    const { app } = require('../src/server');

    httpServer = await listen(app);
    sseConnection = await openSse(httpServer);
    const clientId = sseConnection.res.headers['x-client-id'];

    const response = await request(httpServer)
      .post('/messages')
      .set('content-type', 'application/json')
      .set('x-client-id', clientId)
      .send({ hello: 'world' });

    expect(response.status).to.equal(200);
    expect(transportInstance.handlePostMessage.calledOnce).to.be.true;
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
