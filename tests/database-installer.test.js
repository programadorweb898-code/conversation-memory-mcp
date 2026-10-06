const assert = require("node:assert/strict");
const { existsSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { Readable, Writable } = require("node:stream");
const { DATABASE_URL_ENV } = require("../src/databaseConfig");
const { confirmMigrationTarget } = require("../scripts/migrate");
const {
  ensureEnvIgnored,
  getDatabaseEnvFile,
  loadEnvironment,
  setupDatabase,
  upsertEnvValue,
} = require("../src/installer/database");

describe("database installer", () => {
  it("writes the dedicated database URL without duplicating the key", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-db-"));

    upsertEnvValue(cwd, DATABASE_URL_ENV, "postgresql://one");
    upsertEnvValue(cwd, DATABASE_URL_ENV, "postgresql://two");

    const content = readFileSync(join(cwd, ".env"), "utf8");
    assert.equal(content, `${DATABASE_URL_ENV}="postgresql://two"\n`);
  });

  it("keeps unrelated .env variables", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-db-"));

    upsertEnvValue(cwd, "MCP_DEFAULT_OWNER", "local-user");
    upsertEnvValue(cwd, DATABASE_URL_ENV, "postgresql://example");

    const content = readFileSync(join(cwd, ".env"), "utf8");
    assert.match(content, /MCP_DEFAULT_OWNER="local-user"/);
    assert.match(content, new RegExp(`${DATABASE_URL_ENV}="postgresql:\\/\\/example"`));
  });

  it("does not adopt an application's generic DATABASE_URL", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-db-"));
    writeFileSync(join(cwd, ".env"), 'DATABASE_URL="postgresql://application/db"\n');
    const previousDedicatedUrl = process.env[DATABASE_URL_ENV];
    const previousApplicationUrl = process.env.DATABASE_URL;

    try {
      delete process.env[DATABASE_URL_ENV];
      delete process.env.DATABASE_URL;
      assert.equal(loadEnvironment(cwd), "");
      assert.equal(process.env.DATABASE_URL, "postgresql://application/db");
    } finally {
      if (previousDedicatedUrl === undefined) delete process.env[DATABASE_URL_ENV];
      else process.env[DATABASE_URL_ENV] = previousDedicatedUrl;
      if (previousApplicationUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousApplicationUrl;
    }
  });

  it("reads the dedicated URL only from the target .env", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-db-"));
    const elsewhere = mkdtempSync(join(tmpdir(), "conversation-memory-db-other-"));
    writeFileSync(join(cwd, ".env"), `${DATABASE_URL_ENV}="postgresql://target@memory.example/db"\n`);
    writeFileSync(join(elsewhere, ".env"), `${DATABASE_URL_ENV}="postgresql://unrelated@other.example/db"\n`);
    const previousDedicatedUrl = process.env[DATABASE_URL_ENV];
    const previousCwd = process.cwd();

    try {
      process.chdir(elsewhere);
      delete process.env[DATABASE_URL_ENV];
      assert.equal(loadEnvironment(cwd), "postgresql://target@memory.example/db");
    } finally {
      process.chdir(previousCwd);
      if (previousDedicatedUrl === undefined) delete process.env[DATABASE_URL_ENV];
      else process.env[DATABASE_URL_ENV] = previousDedicatedUrl;
    }
  });

  it("prefers an exported dedicated URL over the target .env", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-db-"));
    writeFileSync(join(cwd, ".env"), `${DATABASE_URL_ENV}="postgresql://from-file@memory.example/db"\n`);
    const previousDedicatedUrl = process.env[DATABASE_URL_ENV];

    try {
      process.env[DATABASE_URL_ENV] = "postgresql://from-env@memory.example/db";
      assert.equal(loadEnvironment(cwd), "postgresql://from-env@memory.example/db");
    } finally {
      if (previousDedicatedUrl === undefined) delete process.env[DATABASE_URL_ENV];
      else process.env[DATABASE_URL_ENV] = previousDedicatedUrl;
    }
  });

  it("stores a global installation URL outside the project cwd", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-db-project-"));
    const userConfig = mkdtempSync(join(tmpdir(), "conversation-memory-user-config-"));
    const previousXdg = process.env.XDG_CONFIG_HOME;
    const previousAppData = process.env.APPDATA;
    const previousDedicatedUrl = process.env[DATABASE_URL_ENV];
    const connectionString = "postgresql://dedicated@memory.example/db";

    try {
      if (process.platform === "win32") process.env.APPDATA = userConfig;
      else process.env.XDG_CONFIG_HOME = userConfig;
      process.env[DATABASE_URL_ENV] = connectionString;
      await setupDatabase({
        cwd,
        scope: "global",
        input: Readable.from(["s\n"]),
        output: new Writable({ write(chunk, encoding, callback) { callback(); } }),
        testConnection: async () => {},
        migrate: async () => {},
      });

      const globalEnvFile = getDatabaseEnvFile(cwd, "global");
      assert.equal(globalEnvFile.startsWith(userConfig), true);
      assert.equal(existsSync(join(cwd, ".env")), false);
      assert.match(readFileSync(globalEnvFile, "utf8"), new RegExp(DATABASE_URL_ENV));
    } finally {
      if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousXdg;
      if (previousAppData === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = previousAppData;
      if (previousDedicatedUrl === undefined) delete process.env[DATABASE_URL_ENV];
      else process.env[DATABASE_URL_ENV] = previousDedicatedUrl;
    }
  });

  it("requires explicit confirmation before writing the URL or migrating", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-db-"));
    const connectionString = "postgresql://dedicated-user:secret@memory.example/db";
    const previousDedicatedUrl = process.env[DATABASE_URL_ENV];
    let output = "";
    const writable = new Writable({ write(chunk, encoding, callback) { output += chunk; callback(); } });
    const migrate = async () => { throw new Error("should not migrate without confirmation"); };

    try {
      process.env[DATABASE_URL_ENV] = connectionString;
      await assert.rejects(
        setupDatabase({
          cwd,
          input: Readable.from(["n\n"]),
          output: writable,
          testConnection: async () => {},
          migrate,
        }),
        /Migración cancelada/,
      );
      assert.match(output, /memory\.example/);
      assert.match(output, /base está dedicada/i);
      assert.equal(existsSync(join(cwd, ".env")), false);
    } finally {
      if (previousDedicatedUrl === undefined) delete process.env[DATABASE_URL_ENV];
      else process.env[DATABASE_URL_ENV] = previousDedicatedUrl;
    }
  });

  it("persists the dedicated URL and migrates only after confirmation", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-db-"));
    const connectionString = "postgresql://dedicated-user:secret@memory.example/db";
    const previousDedicatedUrl = process.env[DATABASE_URL_ENV];
    let migrationCount = 0;

    try {
      process.env[DATABASE_URL_ENV] = connectionString;
      const result = await setupDatabase({
        cwd,
        input: Readable.from(["s\n"]),
        output: new Writable({ write(chunk, encoding, callback) { callback(); } }),
        testConnection: async () => {},
        migrate: async () => { migrationCount += 1; },
      });
      const content = readFileSync(join(cwd, ".env"), "utf8");

      assert.match(content, new RegExp(`${DATABASE_URL_ENV}="postgresql:`));
      assert.doesNotMatch(content, /^DATABASE_URL=/m);
      assert.equal(migrationCount, 1);
      assert.deepEqual(result.target, { host: "memory.example", database: "db" });
    } finally {
      if (previousDedicatedUrl === undefined) delete process.env[DATABASE_URL_ENV];
      else process.env[DATABASE_URL_ENV] = previousDedicatedUrl;
    }
  });

  it("shows only host, database and schema in its migration confirmation", async () => {
    const previousSchema = process.env.PG_SEARCH_PATH;
    let output = "";
    const writable = new Writable({ write(chunk, encoding, callback) { output += chunk; callback(); } });

    try {
      process.env.PG_SEARCH_PATH = "conversation_memory";
      const confirmed = await confirmMigrationTarget(
        "postgresql://user:secret@memory.example/db",
        Readable.from(["s\n"]),
        writable,
      );

      assert.equal(confirmed, true);
      assert.match(output, /Host: memory\.example/);
      assert.match(output, /Base: db/);
      assert.match(output, /Schema: conversation_memory/);
      assert.doesNotMatch(output, /secret/);
    } finally {
      if (previousSchema === undefined) delete process.env.PG_SEARCH_PATH;
      else process.env.PG_SEARCH_PATH = previousSchema;
    }
  });

  it("adds .env to .gitignore only once", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-db-"));

    assert.equal(ensureEnvIgnored(cwd), true);
    assert.equal(ensureEnvIgnored(cwd), false);

    const content = readFileSync(join(cwd, ".gitignore"), "utf8");
    assert.equal(content, ".env\n");
  });

  it("does not duplicate an existing .env gitignore entry", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conversation-memory-db-"));

    require("node:fs").writeFileSync(join(cwd, ".gitignore"), "node_modules/\n.env\n");
    assert.equal(ensureEnvIgnored(cwd), false);
    assert.equal(readFileSync(join(cwd, ".gitignore"), "utf8"), "node_modules/\n.env\n");
  });
});
