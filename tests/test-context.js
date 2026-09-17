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

  it('throws instead of using a hardcoded personal owner', () => {
    delete process.env.MCP_DEFAULT_OWNER;

    expect(() => resolveWriteOwner()).to.throw(
      'MCP_DEFAULT_OWNER environment variable is required when no authenticated owner is available.'
    );
  });
});
