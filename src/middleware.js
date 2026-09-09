const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const { hashToken, findByTokenHash, touchApiKey } = require("./services/apiKeyService");

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

// comparación constante para mitigar ataques de temporización
function tokensMatch(expectedBuffer, tokenBuffer) {
  if (tokenBuffer.length !== expectedBuffer.length) {
    const dummy = Buffer.alloc(tokenBuffer.length);
    crypto.timingSafeEqual(dummy, dummy);
    return false;
  }
  return crypto.timingSafeEqual(tokenBuffer, expectedBuffer);
}

/**
 * Aplica el scoping de proyecto a un request tools/call:
 *  - si el token tiene proyecto y el request pide otro -> 403;
 *  - si el token tiene proyecto y el request no pide ninguno -> lo inyecta.
 */
function scopeProject(req, res, apiKey) {
  if (!apiKey.project || req.method !== "POST" || !req.body) {
    return true;
  }

  const params = req.body.params;
  const isToolCall =
    req.body.method === "tools/call" &&
    params &&
    typeof params === "object" &&
    params.arguments &&
    typeof params.arguments === "object";

  if (!isToolCall) {
    return true;
  }

  const requestedProject = params.arguments.project;

  if (requestedProject !== undefined && requestedProject !== apiKey.project) {
    res.status(403).json({
      error: `Este token solo puede acceder al proyecto "${apiKey.project}".`,
    });
    return false;
  }

  if (requestedProject === undefined) {
    params.arguments.project = apiKey.project;
  }

  return true;
}

/**
 * Autenticación Bearer multi-tenant:
 *  1) /health no requiere token.
 *  2) El token master (MCP_BEARER_TOKEN) da acceso total (compatibilidad).
 *  3) Los tokens de la tabla api_keys dan acceso a su proyecto.
 */
async function requireBearerToken(req, res, next) {
  if (req.path === "/health") {
    return next();
  }

  const authorization = req.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  let apiKey = null;

  try {
    const expectedToken = process.env.MCP_BEARER_TOKEN || "";
    if (expectedToken && tokensMatch(Buffer.from(expectedToken), Buffer.from(token))) {
      // token master: acceso total, sin scope
      req.auth = { scope: null, master: true };
      return next();
    }

    apiKey = await findByTokenHash(hashToken(token));
    if (!apiKey || !apiKey.enabled) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    req.auth = { scope: apiKey.project || null, master: false, apiKeyId: apiKey.id };

    if (!scopeProject(req, res, apiKey)) {
      return;
    }

    touchApiKey(apiKey.id);
    return next();
  } catch (err) {
    console.error("Error en requireBearerToken:", err.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
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