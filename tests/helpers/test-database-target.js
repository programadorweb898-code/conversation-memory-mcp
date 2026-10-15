const { randomUUID } = require("node:crypto");

function testDatabaseTarget(env = process.env) {
  if (!env.TEST_DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL is required; test setup never uses the application database URL.");
  }
  const prefix = env.TEST_SCHEMA || "cm_test";
  // Only an explicit test namespace is allowed, with room for a unique suffix.
  if (!/^cm_test(?:_[a-z0-9_]+)?$/.test(prefix) || prefix.length > 34) {
    throw new Error("TEST_SCHEMA must be cm_test or a cm_test_ prefix (maximum 34 characters).");
  }
  return {
    connectionString: env.TEST_DATABASE_URL,
    schema: `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
  };
}

module.exports = { testDatabaseTarget };
