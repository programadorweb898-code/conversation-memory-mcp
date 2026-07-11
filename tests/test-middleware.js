const { expect } = require('chai');
const sinon = require('sinon');
const { requireBearerToken } = require('../src/middleware');

describe('requireBearerToken', () => {
  const originalToken = process.env.MCP_BEARER_TOKEN;

  before(() => {
    process.env.MCP_BEARER_TOKEN = 'secret';
  });

  after(() => {
    process.env.MCP_BEARER_TOKEN = originalToken;
  });

  it('should allow /health without token', () => {
    const req = { path: '/health' };
    const res = { status: sinon.stub().returns({ json: sinon.stub() }) };
    const next = sinon.stub();
    requireBearerToken(req, res, next);
    expect(next.calledOnce).to.be.true;
  });

  it('should reject requests without token', () => {
    const req = { path: '/other', get: () => '' };
    const res = { status: sinon.stub().returns({ json: sinon.stub() }) };
    const next = sinon.stub();
    requireBearerToken(req, res, next);
    expect(res.status.calledWith(401)).to.be.true;
  });

  it('should accept valid token', () => {
    const req = { path: '/other', get: (h) => h === 'authorization' ? 'Bearer secret' : '' };
    const res = { status: sinon.stub().returns({ json: sinon.stub() }) };
    const next = sinon.stub();
    requireBearerToken(req, res, next);
    expect(next.calledOnce).to.be.true;
  });

  it('should reject invalid token', () => {
    const req = { path: '/other', get: (h) => h === 'authorization' ? 'Bearer wrong' : '' };
    const res = { status: sinon.stub().returns({ json: sinon.stub() }) };
    const next = sinon.stub();
    requireBearerToken(req, res, next);
    expect(res.status.calledWith(401)).to.be.true;
  });
});
