const { expect } = require("chai");
const sinon = require("sinon");

const searchMessages = require("../src/tools/searchMessages");
const { lexicalSearch } = require("../src/services/lexicalSearch");
const { db } = require("../src/database");
const { config } = require("../src/config");

describe("Search result limits", () => {
  let allAsyncStub;
  let originalLimit;

  beforeEach(() => {
    originalLimit = config.searchLimit;
    config.searchLimit = 3;
  });

  afterEach(() => {
    config.searchLimit = originalLimit;
    if (allAsyncStub) {
      allAsyncStub.restore();
      allAsyncStub = null;
    }
  });

  it("should apply the configured limit to searchMessages without a search term", async () => {
    allAsyncStub = sinon.stub(db, "allAsync").resolves([]);

    await searchMessages({ project: "limit-test" });

    expect(allAsyncStub.calledOnce).to.equal(true);
    expect(allAsyncStub.firstCall.args[0]).to.include("LIMIT $2");
    expect(allAsyncStub.firstCall.args[1]).to.deep.equal(["limit-test", 3]);
  });

  it("should cap lexicalSearch requests at the configured limit", async () => {
    allAsyncStub = sinon.stub(db, "allAsync").resolves([]);

    await lexicalSearch({
      searchTerm: "important message",
      project: "limit-test",
      limit: 1000,
    });

    expect(allAsyncStub.calledOnce).to.equal(true);
    const params = allAsyncStub.firstCall.args[1];
    expect(params[params.length - 1]).to.equal(3);
  });
});
