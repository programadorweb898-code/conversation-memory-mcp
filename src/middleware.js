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

function requireJson(req, res, next) {
  const contentType = req.headers["content-type"] || "";

  if (!contentType.includes("application/json")) {
    return res.status(415).json({
      error: "Content-Type debe ser application/json",
    });
  }

  next();
}

function applyMiddleware(app) {
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    xPoweredBy: true,
  }));
  app.use(sseLimiter);
  app.use(messagesLimiter);
  app.use(requireJson);
}

module.exports = {
  sseLimiter,
  messagesLimiter,
  requireJson,
  applyMiddleware,
};
