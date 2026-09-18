const { expect } = require('chai');
const { resolveWriteOwner } = require('../src/context');

describe('Authentication context', function () {
  const originalOwner = process.env.MCP_DEFAULT_OWNER;

  afterEach(() => {
    if (originalOwner === undefined) {
      delete process.env.MCP_DEFAULT_OWNER;
    } else {
      process.env.MCP_DEFAULT_OWNER = originalOwner;
    }
  });

  it('uses the authenticated owner when available', () => {
    process.env.MCP_DEFAULT_OWNER = 'default-owner';
    expect(resolveWriteOwner('authenticated-owner')).to.equal('authenticated-owner');
  });

  it('uses MCP_DEFAULT_OWNER when there is no authenticated owner', () => {
    process.env.MCP_DEFAULT_OWNER = 'default-owner';
    expect(resolveWriteOwner()).to.equal('default-owner');
  });

  it('uses the safe local owner when no owner is configured', () => {
    delete process.env.MCP_DEFAULT_OWNER;

    expect(resolveWriteOwner()).to.equal('local-user');
  });
});
