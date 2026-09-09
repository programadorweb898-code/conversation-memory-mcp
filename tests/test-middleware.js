const { expect } = require('chai');
const sinon = require('sinon');
const { requireBearerToken } = require('../src/middleware');
const { db } = require('../src/database');
const {
  createApiKey,
  revokeApiKey,
  findByTokenHash,
  hashToken,
} = require('../src/services/apiKeyService');

const SCOPED_TOKEN = 'scoped-test-token-123';
const REVOKE_TOKEN = 'revoke-test-token-456';

function mockReq({ path = '/other', authorization = '', body = null, method = 'GET' } = {}) {
  return {
    path,
    method,
    body,
    get: (h) => (h === 'authorization' ? authorization : ''),
  };
}

function mockRes() {
  return { status: sinon.stub().returns({ json: sinon.stub() }) };
}

function toolCall(argumentsObj) {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'searchMessages', arguments: argumentsObj },
  };
}

describe('requireBearerToken', () => {
  const originalToken = process.env.MCP_BEARER_TOKEN;

  before(async function () {
    this.timeout(20000);
    process.env.MCP_BEARER_TOKEN = 'secret';

    const scoped = await createApiKey({ name: 'test-scoped', project: 'proyecto-test' });
    const toRevoke = await createApiKey({ name: 'test-to-revoke', project: 'proyecto-test' });

    await db.runAsync(`UPDATE api_keys SET token_hash = $1 WHERE id = $2`, [hashToken(SCOPED_TOKEN), scoped.key.id]);
    await db.runAsync(`UPDATE api_keys SET token_hash = $1 WHERE id = $2`, [hashToken(REVOKE_TOKEN), toRevoke.key.id]);
  });

  after(async function () {
    this.timeout(20000);
    process.env.MCP_BEARER_TOKEN = originalToken;
    await db.runAsync(`DELETE FROM api_keys WHERE name IN ('test-scoped', 'test-to-revoke')`);
  });

  it('should allow /health without token', async () => {
    const req = { path: '/health' };
    const res = mockRes();
    const next = sinon.stub();
    await requireBearerToken(req, res, next);
    expect(next.calledOnce).to.be.true;
  });

  it('should reject requests without token', async () => {
    const req = mockReq();
    const res = mockRes();
    const next = sinon.stub();
    await requireBearerToken(req, res, next);
    expect(res.status.calledWith(401)).to.be.true;
  });

  it('should accept valid master token', async () => {
    const req = mockReq({ authorization: 'Bearer secret' });
    const res = mockRes();
    const next = sinon.stub();
    await requireBearerToken(req, res, next);
    expect(next.calledOnce).to.be.true;
    expect(req.auth).to.deep.equal({ scope: null, master: true });
  });

  it('should reject invalid token', async () => {
    const req = mockReq({ authorization: 'Bearer wrong' });
    const res = mockRes();
    const next = sinon.stub();
    await requireBearerToken(req, res, next);
    expect(res.status.calledWith(401)).to.be.true;
  });

  it('should look up tokens by sha256 hash only', async () => {
    const rows = await db.allAsync(`SELECT * FROM api_keys WHERE name IN ('test-scoped', 'test-to-revoke')`);
    expect(rows).to.have.lengthOf(2);
    for (const row of rows) {
      expect(row.token_hash).to.match(/^[0-9a-f]{64}$/);
      expect(row.token_hash).to.not.include(SCOPED_TOKEN);
      expect(row.token_hash).to.not.include(REVOKE_TOKEN);
    }
    const found = await findByTokenHash(rows[0].token_hash);
    expect(found).to.exist;
    expect(found.project).to.equal('proyecto-test');
  });

  it('should accept a scoped token and set req.auth.scope', async () => {
    const req = mockReq({ authorization: `Bearer ${SCOPED_TOKEN}` });
    const res = mockRes();
    const next = sinon.stub();
    await requireBearerToken(req, res, next);
    expect(next.calledOnce).to.be.true;
    expect(req.auth.scope).to.equal('proyecto-test');
    expect(req.auth.master).to.be.false;
  });

  it('should inject the scoped project into a tools/call without project', async () => {
    const body = toolCall({ searchTerm: 'hola' });
    const req = mockReq({ authorization: `Bearer ${SCOPED_TOKEN}`, body, method: 'POST' });
    const res = mockRes();
    const next = sinon.stub();

    await requireBearerToken(req, res, next);

    expect(next.calledOnce).to.be.true;
    expect(req.body.params.arguments.project).to.equal('proyecto-test');
  });

  it('should allow a tools/call when project matches the token', async () => {
    const body = toolCall({ project: 'proyecto-test', searchTerm: 'hola' });
    const req = mockReq({ authorization: `Bearer ${SCOPED_TOKEN}`, body, method: 'POST' });
    const res = mockRes();
    const next = sinon.stub();

    await requireBearerToken(req, res, next);

    expect(next.calledOnce).to.be.true;
    expect(req.body.params.arguments.project).to.equal('proyecto-test');
  });

  it('should reject a tools/call with a different project (403)', async () => {
    const body = toolCall({ project: 'otro-proyecto' });
    const req = mockReq({ authorization: `Bearer ${SCOPED_TOKEN}`, body, method: 'POST' });
    const res = mockRes();
    const next = sinon.stub();

    await requireBearerToken(req, res, next);

    expect(res.status.calledWith(403)).to.be.true;
    expect(next.called).to.be.false;
  });

  it('should not alter non-tool-call messages for a scoped token', async () => {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    };
    const req = mockReq({ authorization: `Bearer ${SCOPED_TOKEN}`, body, method: 'POST' });
    const res = mockRes();
    const next = sinon.stub();

    await requireBearerToken(req, res, next);

    expect(next.calledOnce).to.be.true;
    expect(req.body.params).to.equal(undefined);
  });

  it('should reject a disabled scoped token (401)', async () => {
    const toRevoke = await db.getAsync(`SELECT id FROM api_keys WHERE name = 'test-to-revoke'`);
    await revokeApiKey(toRevoke.id);

    const req = mockReq({ authorization: `Bearer ${REVOKE_TOKEN}` });
    const res = mockRes();
    const next = sinon.stub();

    await requireBearerToken(req, res, next);

    expect(res.status.calledWith(401)).to.be.true;
    expect(next.called).to.be.false;
  });
});