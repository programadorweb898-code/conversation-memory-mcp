const assert = require("node:assert/strict");
const sinon = require("sinon");

const { ensureSchemaUpToDate, guardStartupSchema, readAppliedVersions } = require("../src/schemaGuard");

const MIGRATIONS = [
  { version: 1, name: "001_init.sql" },
  { version: 12, name: "012_query_indexes.sql" },
  { version: 14, name: "014_project_path.sql" },
];

function createLogger() {
  return { log: sinon.stub(), error: sinon.stub() };
}

describe("schemaGuard", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("returns ok when every bundled migration is already applied", async () => {
    const allAsync = sinon.stub().resolves([{ version: 1 }, { version: 12 }, { version: 14 }]);

    const result = await ensureSchemaUpToDate({ allAsync, migrations: MIGRATIONS });

    assert.deepEqual(result, { status: "ok", pending: [] });
  });

  it("casts versions to number before comparing", async () => {
    const allAsync = sinon.stub().resolves([{ version: "1" }, { version: "12" }, { version: "14" }]);

    const result = await ensureSchemaUpToDate({ allAsync, migrations: MIGRATIONS });

    assert.equal(result.status, "ok");
  });

  it("throws SCHEMA_OUTDATED with the pending names when behind and auto-migrate is off", async () => {
    const allAsync = sinon.stub().resolves([{ version: 1 }]);

    await assert.rejects(
      () => ensureSchemaUpToDate({ allAsync, migrations: MIGRATIONS, autoMigrate: false }),
      (error) => {
        assert.equal(error.code, "SCHEMA_OUTDATED");
        assert.deepEqual(error.pending, ["012_query_indexes.sql", "014_project_path.sql"]);
        assert.match(error.message, /conversation-memory-mcp migrate/);
        assert.match(error.message, /CONVERSATION_MEMORY_AUTO_MIGRATE=true/);
        return true;
      },
    );
  });

  it("runs migrations with confirmed=true when auto-migrate is on", async () => {
    const allAsync = sinon.stub().resolves([{ version: 1 }]);
    const migrate = sinon.stub().resolves();
    const log = createLogger();

    const result = await ensureSchemaUpToDate({
      allAsync,
      migrations: MIGRATIONS,
      autoMigrate: true,
      migrate,
      log,
    });

    assert.equal(result.status, "migrated");
    assert.deepEqual(result.pending.map((migration) => migration.version), [12, 14]);
    assert.equal(migrate.calledOnceWithExactly({ logger: log, confirmed: true }), true);
    assert.equal(log.log.calledOnce, true);
  });

  it("treats a missing schema_migrations table as nothing applied", async () => {
    const allAsync = sinon.stub().rejects(Object.assign(new Error("relation does not exist"), { code: "42P01" }));

    await assert.rejects(
      () => ensureSchemaUpToDate({ allAsync, migrations: MIGRATIONS, autoMigrate: false }),
      (error) => {
        assert.equal(error.code, "SCHEMA_OUTDATED");
        assert.equal(error.pending.length, 3);
        return true;
      },
    );
  });

  it("propagates unexpected database errors", async () => {
    const boom = Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
    const allAsync = sinon.stub().rejects(boom);

    await assert.rejects(
      () => ensureSchemaUpToDate({ allAsync, migrations: MIGRATIONS }),
      (error) => error === boom,
    );
  });

  it("readAppliedVersions returns an empty set when the table is missing", async () => {
    const allAsync = sinon.stub().rejects(Object.assign(new Error("no table"), { code: "42P01" }));

    const applied = await readAppliedVersions(allAsync);

    assert.equal(applied.size, 0);
  });

  it("guardStartupSchema swallows connection errors and reports unverified", async () => {
    const log = createLogger();
    const allAsync = sinon.stub().rejects(Object.assign(new Error("terminated"), { code: "08006" }));

    const result = await guardStartupSchema({ allAsync, migrations: MIGRATIONS, log });

    assert.equal(result.status, "unverified");
    assert.equal(log.error.calledOnce, true);
  });

  it("guardStartupSchema rethrows SCHEMA_OUTDATED instead of hiding it", async () => {
    const allAsync = sinon.stub().resolves([{ version: 1 }]);

    await assert.rejects(
      () => guardStartupSchema({ allAsync, migrations: MIGRATIONS, autoMigrate: false }),
      (error) => error.code === "SCHEMA_OUTDATED",
    );
  });
});
