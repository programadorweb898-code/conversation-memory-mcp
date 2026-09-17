const { expect } = require("chai");
const sinon = require("sinon");
const { db } = require("./test-helper");

const finalizeSessionPath = require.resolve("../src/tools/finalizeSession");
const sessionManagerPath = require.resolve("../src/services/sessionManager");

function loadSessionManager(finalizeStub) {
  delete require.cache[sessionManagerPath];
  const originalModule = require.cache[finalizeSessionPath];
  require.cache[finalizeSessionPath] = {
    id: finalizeSessionPath,
    filename: finalizeSessionPath,
    loaded: true,
    exports: finalizeStub,
  };

  const manager = require("../src/services/sessionManager");

  if (originalModule) {
    require.cache[finalizeSessionPath] = originalModule;
  } else {
    delete require.cache[finalizeSessionPath];
  }

  return manager;
}

describe("Session Manager", function () {
  let finalizeStub;
  let manager;
  let allAsyncStub;
  let clock;

  beforeEach(() => {
    sinon.restore();
    finalizeStub = sinon.stub().resolves({ success: true });
    manager = loadSessionManager(finalizeStub);
    allAsyncStub = sinon.stub(db, "allAsync").resolves([]);
  });

  afterEach(() => {
    manager.stopSessionMonitor();
    if (clock) {
      clock.restore();
      clock = null;
    }
    sinon.restore();
    delete require.cache[sessionManagerPath];
  });

  it("finaliza solo las sesiones que llevan más de cinco minutos inactivas", async () => {
    const now = Date.parse("2026-09-17T12:00:00.000Z");
    clock = sinon.useFakeTimers({ now });
    allAsyncStub.resolves([
      {
        session_id: "inactive",
        project: "project-a",
        owner: "owner-a",
        last_activity: "2026-09-17T11:54:00.000Z",
      },
      {
        session_id: "recent",
        project: "project-a",
        owner: "owner-a",
        last_activity: "2026-09-17T11:59:00.000Z",
      },
    ]);

    await manager.checkAndFinalizeInactiveSessions();

    expect(finalizeStub.calledOnce).to.equal(true);
    expect(finalizeStub.firstCall.args).to.deep.equal([
      { sessionId: "inactive", project: "project-a", owner: "owner-a" },
    ]);
  });

  it("continúa procesando otras sesiones si finalizeSession falla en una de ellas", async () => {
    const now = Date.parse("2026-09-17T12:00:00.000Z");
    clock = sinon.useFakeTimers({ now });
    finalizeStub.onFirstCall().rejects(new Error("LLM unavailable"));
    allAsyncStub.resolves([
      {
        session_id: "first",
        project: "project-a",
        owner: "owner-a",
        last_activity: "2026-09-17T11:50:00.000Z",
      },
      {
        session_id: "second",
        project: "project-b",
        owner: "owner-b",
        last_activity: "2026-09-17T11:51:00.000Z",
      },
    ]);

    await manager.checkAndFinalizeInactiveSessions();

    expect(finalizeStub.callCount).to.equal(2);
    expect(finalizeStub.secondCall.args).to.deep.equal([
      { sessionId: "second", project: "project-b", owner: "owner-b" },
    ]);
  });

  it("no falla si la consulta de sesiones falla", async () => {
    allAsyncStub.rejects(new Error("database unavailable"));

    await manager.checkAndFinalizeInactiveSessions();

    expect(finalizeStub.called).to.equal(false);
  });

  it("crea y detiene el intervalo del monitor", () => {
    clock = sinon.useFakeTimers();

    manager.startSessionMonitor();
    manager.stopSessionMonitor();

    expect(() => manager.stopSessionMonitor()).not.to.throw();
  });

  it("no finaliza una sesión exactamente en el umbral de cinco minutos", async () => {
    const now = Date.parse("2026-09-17T12:00:00.000Z");
    clock = sinon.useFakeTimers({ now });
    allAsyncStub.resolves([
      {
        session_id: "boundary",
        project: "project-a",
        owner: "owner-a",
        last_activity: "2026-09-17T11:55:00.000Z",
      },
    ]);

    await manager.checkAndFinalizeInactiveSessions();

    expect(finalizeStub.called).to.equal(false);
  });
});
