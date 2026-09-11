const express = require("express");
const { randomUUID } = require("crypto");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const saveMessage = require("./tools/saveMessage");
const searchMessages = require("./tools/searchMessages");

const DEMO_PROJECT = "portfolio-demo";
const DEMO_AGENT_PREFIX = "portfolio-demo-";
const DEMO_SESSION_PREFIX = "portfolio-session-";

const demoLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Demo rate limit exceeded" },
});

const searchSchema = z.object({
  demoId: z.string().uuid(),
  query: z.string().trim().min(1).max(200),
});

function setupDemoRoutes(app) {
  const router = express.Router();
  router.use(demoLimiter);

  router.post("/session", async (req, res, next) => {
    try {
      const demoId = randomUUID();
      const agentId = `${DEMO_AGENT_PREFIX}${demoId}`;
      const sessionId = `${DEMO_SESSION_PREFIX}${demoId}`;

      await saveMessage({
        sessionId,
        project: DEMO_PROJECT,
        agentId,
        role: "user",
        content:
          "Estoy construyendo TaskFlow, una API de gestión de tareas con Node.js, Express y PostgreSQL.",
      });

      await saveMessage({
        sessionId,
        project: DEMO_PROJECT,
        agentId,
        role: "assistant",
        content: "Entendido. Voy a conservar ese contexto para futuras sesiones.",
      });

      res.status(201).json({ demoId, sessionId });
    } catch (error) {
      next(error);
    }
  });

  router.post("/search", async (req, res, next) => {
    try {
      const { demoId, query } = searchSchema.parse(req.body);
      const agentId = `${DEMO_AGENT_PREFIX}${demoId}`;

      const results = await searchMessages({
        searchTerm: query,
        project: DEMO_PROJECT,
        agentId,
      });

      const relevant = Array.isArray(results) ? results.slice(0, 5) : [];
      res.json({
        query,
        results: relevant,
        context: relevant[0]?.content ?? null,
      });
    } catch (error) {
      if (error?.name === "ZodError") {
        return res.status(400).json({ error: "Invalid demo search request" });
      }
      next(error);
    }
  });

  app.use("/demo", router);
}

module.exports = { setupDemoRoutes };
