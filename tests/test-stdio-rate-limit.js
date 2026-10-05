const { expect } = require("chai");
const sinon = require("sinon");
const { createRateLimiter, withLocalToolRateLimit } = require("../src/services/stdioRateLimiter");
const { runWithAuth } = require("../src/context");

describe("stdio tool rate limit", () => {
  let originalOwner;

  beforeEach(() => {
    originalOwner = process.env.MCP_DEFAULT_OWNER;
  });

  afterEach(() => {
    if (originalOwner === undefined) delete process.env.MCP_DEFAULT_OWNER;
    else process.env.MCP_DEFAULT_OWNER = originalOwner;
  });

  it("keeps a separate 60-call window for each local owner", async () => {
    const ownerA = `stdio-rate-limit-a-${Date.now()}`;
    const ownerB = `stdio-rate-limit-b-${Date.now()}`;
    const handler = sinon.stub().resolves({ content: [{ type: "text", text: "ok" }] });
    process.env.MCP_DEFAULT_OWNER = ownerA;
    const firstClientKey = withLocalToolRateLimit(handler);
    const secondClientKey = withLocalToolRateLimit(handler);
    for (let call = 0; call < 60; call += 1) {
      await firstClientKey();
    }

    const exhausted = await secondClientKey();
    expect(exhausted.isError).to.equal(true);
    expect(exhausted.content[0].text).to.include("60 llamadas por minuto");
    expect(handler.callCount).to.equal(60);

    process.env.MCP_DEFAULT_OWNER = ownerB;
    const otherOwner = await withLocalToolRateLimit(handler)();
    expect(otherOwner.isError).to.not.equal(true);
    expect(handler.callCount).to.equal(61);
  });

  it("starts a new window after the configured interval", () => {
    const limiter = createRateLimiter({ maxCalls: 1, windowMs: 1000 });

    expect(limiter.consume("owner", 1000).allowed).to.equal(true);
    expect(limiter.consume("owner", 1500).allowed).to.equal(false);
    expect(limiter.consume("owner", 2000).allowed).to.equal(true);
  });

  it("leaves authenticated HTTP calls to the HTTP rate limiter", async () => {
    const handler = sinon.stub().resolves({ content: [{ type: "text", text: "ok" }] });
    const limitedHandler = withLocalToolRateLimit(handler);

    await runWithAuth({ owner: "http-rate-limit-test" }, async () => {
      for (let call = 0; call < 61; call += 1) {
        await limitedHandler();
      }
    });

    expect(handler.callCount).to.equal(61);
  });
});