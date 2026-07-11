const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");

// límite para conexiones SSE: máximo 10 por IP por minuto
const sseLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "Demasiadas conexiones SSE. Intentá en un minuto." },
  standardHeaders: true,
  legacyHeaders: false,
});

// límite para mensajes: máximo 60 por IP por minuto
const messagesLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: "Demasiados mensajes. Intentá en un minuto." },
  standardHeaders: true,
  legacyHeaders: false,
});

function requireBearerToken(req, res, next) {
  if (req.path === "/health") {
    return next();
  }

  const authorization = req.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const expectedToken = process.env.MCP_BEARER_TOKEN || "";

  const tokenBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(expectedToken);

  if (tokenBuffer.length !== expectedBuffer.length) {
    // Para mitigar ataques de temporización, comparar con un buffer dummy
    // del mismo tamaño para que la operación tome un tiempo constante.
    const dummy = Buffer.alloc(tokenBuffer.length);
    crypto.timingSafeEqual(dummy, dummy);
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!crypto.timingSafeEqual(tokenBuffer, expectedBuffer)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}

function requireJson(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  const contentType = req.headers["content-type"] || "";

  if (!contentType.includes("application/json")) {
    return res.status(415).json({
      error: "Content-Type debe ser application/json",
    });
  }

  next();
}

function applyMiddleware(app) {
  app.use(helmet());
  app.use(sseLimiter);
  app.use(messagesLimiter);
  app.use(requireBearerToken);
  app.use(requireJson);
}

module.exports = {
  sseLimiter,
  messagesLimiter,
  requireBearerToken,
  requireJson,
  applyMiddleware,
};
