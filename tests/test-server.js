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

  it('should close the SSE MCP server exactly once when the client disconnects', async function () {
    this.timeout(5000);
    const { app } = require('../src/server');

    httpServer = await listen(app);
    sseConnection = await openSse(httpServer);

    const closeObserved = new Promise((resolve) => {
      serverCloseStub.callsFake(resolve);
    });

    sseConnection.req.destroy();
    sseConnection.res.destroy();

    await closeObserved;

    expect(serverCloseStub.calledOnce).to.be.true;
  });

  it('should reject an SSE session used with a different API key', async function () {
    this.timeout(30000);
    const owner = `sse-owner-${Date.now()}`;
    const first = await createApiKey({ name: `sse-key-a-${Date.now()}`, owner });
    const second = await createApiKey({ name: `sse-key-b-${Date.now()}`, owner });
