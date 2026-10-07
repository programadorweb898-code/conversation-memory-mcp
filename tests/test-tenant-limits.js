const { expect } = require("chai");
const sinon = require("sinon");
const { EventEmitter } = require("node:events");
const {
  createConcurrencyLimiter,
} = require("../src/middleware");

function mockRes() {
  const res = new EventEmitter();
  res.setHeader = sinon.spy();
  res.status = sinon.stub().returns({
    json: sinon.stub(),
  });
  return res;
}

function mockReq(owner) {
  return {
    auth: {
      master: false,
      owner,
      apiKeyId: `key-${owner}`,
    },
  };
}

describe("multi-tenant concurrency limits", () => {
  it("shares a concurrency limit across API keys belonging to the same owner", () => {
    const limiter = createConcurrencyLimiter({
      getLimit: () => 2,
      keyGenerator: (req) => `owner:${req.auth.owner}`,
      message: "too many",
    });

    const reqA1 = mockReq("owner-a");
    const resA1 = mockRes();
    const nextA1 = sinon.spy();

    const reqA2 = mockReq("owner-a");
    const resA2 = mockRes();
    const nextA2 = sinon.spy();

    const reqA3 = mockReq("owner-a");
    const resA3 = mockRes();
    const nextA3 = sinon.spy();

    limiter(reqA1, resA1, nextA1);
    limiter(reqA2, resA2, nextA2);
    limiter(reqA3, resA3, nextA3);

    expect(nextA1.calledOnce).to.be.true;
    expect(nextA2.calledOnce).to.be.true;
    expect(nextA3.called).to.be.false;
    expect(resA3.status.calledWith(429)).to.be.true;
  });

  it("keeps different owners isolated", () => {
    const limiter = createConcurrencyLimiter({
      getLimit: () => 1,
      keyGenerator: (req) => `owner:${req.auth.owner}`,
      message: "too many",
    });

    const resA = mockRes();
    const resB = mockRes();
    const nextA = sinon.spy();
    const nextB = sinon.spy();

    limiter(mockReq("owner-a"), resA, nextA);
    limiter(mockReq("owner-b"), resB, nextB);

    expect(nextA.calledOnce).to.be.true;
    expect(nextB.calledOnce).to.be.true;
    expect(resA.status.called).to.be.false;
    expect(resB.status.called).to.be.false;
  });

  it("releases a slot when the response finishes", () => {
    const limiter = createConcurrencyLimiter({
      getLimit: () => 1,
      keyGenerator: (req) => `owner:${req.auth.owner}`,
      message: "too many",
    });

    const firstRes = mockRes();
    const firstNext = sinon.spy();
    limiter(mockReq("owner-a"), firstRes, firstNext);

    const blockedRes = mockRes();
    const blockedNext = sinon.spy();
    limiter(mockReq("owner-a"), blockedRes, blockedNext);
    expect(blockedRes.status.calledWith(429)).to.be.true;

    firstRes.emit("finish");

    const thirdRes = mockRes();
    const thirdNext = sinon.spy();
    limiter(mockReq("owner-a"), thirdRes, thirdNext);

    expect(thirdNext.calledOnce).to.be.true;
    expect(thirdRes.status.called).to.be.false;
  });

  it("does not count the master token against tenant limits", () => {
    const limiter = createConcurrencyLimiter({
      getLimit: () => 1,
      keyGenerator: (req) => `owner:${req.auth.owner}`,
      message: "too many",
    });

    const req = {
      auth: { master: true, owner: null, apiKeyId: null },
    };
    const res = mockRes();
    const next = sinon.spy();

    limiter(req, res, next);

    expect(next.calledOnce).to.be.true;
    expect(res.status.called).to.be.false;
  });

  it("releases only once when both close and finish fire", () => {
    const limiter = createConcurrencyLimiter({
      getLimit: () => 1,
      keyGenerator: (req) => `owner:${req.auth.owner}`,
      message: "too many",
    });

    const firstRes = mockRes();
    limiter(mockReq("owner-a"), firstRes, sinon.spy());
    firstRes.emit("close");
    firstRes.emit("finish");

    const secondRes = mockRes();
    const secondNext = sinon.spy();
    limiter(mockReq("owner-a"), secondRes, secondNext);

    expect(secondNext.calledOnce).to.be.true;
  });
});
