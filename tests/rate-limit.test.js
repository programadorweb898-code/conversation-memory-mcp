const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const { applyMiddleware } = require("../src/middleware");

// Regresión: sseLimiter (10/min) se aplicaba a TODAS las rutas y /mcp devolvía
// 429 a partir de la request 11 del minuto.
describe("rate limiting por ruta", () => {
  function buildApp() {
    const app = express();
    app.set("trust proxy", 1);
    applyMiddleware(app);
    app.use(express.json());
    app.all("/mcp", (req, res) => res.json({ ok: true }));
    return app;
  }

  it("no corta /mcp con el límite de SSE (10/min)", async () => {
    const original = process.env.MCP_BEARER_TOKEN;
    process.env.MCP_BEARER_TOKEN = "rate-limit-test";
    try {
      const app = buildApp();
      for (let i = 0; i < 30; i += 1) {
        const res = await request(app)
          .post("/mcp")
          .set("Authorization", "Bearer rate-limit-test")
          .set("X-Forwarded-For", "203.0.113.7")
          .send({});
        assert.equal(res.status, 200, `request ${i + 1}`);
      }
    } finally {
      if (original === undefined) delete process.env.MCP_BEARER_TOKEN;
      else process.env.MCP_BEARER_TOKEN = original;
    }
  });
});
