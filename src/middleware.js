const crypto = require("crypto");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const helmet = require("helmet");
const { hashToken, findByTokenHash, touchApiKey } = require("./services/apiKeyService");
const { runWithAuth } = require("./context");
const { getConfig } = require("./config");

function rateLimitKeyGenerator(req) {
  if (req.auth?.owner) {
    return `owner:${req.auth.owner}`;
  }

  if (req.auth?.apiKeyId) {
    return `api-key:${req.auth.apiKeyId}`;
  }

  if (req.auth?.master) {
    return "master";
  }

  return `ip:${ipKeyGenerator(req.ip)}`;
}

/**
 * Valida Host/Origin en los transportes HTTP de MCP.
 *
 * MCP_ALLOWED_HOSTS y MCP_ALLOWED_ORIGINS son listas separadas por comas.
 * Si una lista está vacía, esa validación queda deshabilitada para mantener
 * compatibilidad con instalaciones existentes.
 *
 * La validación se ejecuta antes de autenticación para rechazar requests no
 * confiables sin consultar la base de datos.
 */
function validateMcpHostOrigin(req, res, next) {
  if (!["/mcp", "/sse", "/messages"].includes(req.path)) {
    return next();
  }

  const allowedHosts = getConfig().server.allowedHosts;

  const allowedOrigins = getConfig().server.allowedOrigins;

  if (allowedHosts.length > 0) {
    const host = (req.get("host") || "").trim().toLowerCase();
    if (!host || !allowedHosts.includes(host)) {
      return res.status(403).json({ error: "Host no autorizado." });
    }
  }

  if (allowedOrigins.length > 0) {
    const origin = req.get("origin");
    if (origin) {
      const normalizedOrigin = origin.trim().replace(/\/$/, "").toLowerCase();
      if (!allowedOrigins.includes(normalizedOrigin)) {
        return res.status(403).json({ error: "Origin no autorizado." });
      }
    }
  }

  return next();
}

// límite para conexiones SSE: máximo 10 por usuario por minuto
// límite previo a autenticación: máximo 100 requests por IP por minuto.
// Este limiter se ejecuta antes de consultar la base para validar el token.
// Se excluye /health para no interferir con health checks del balanceador.
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: "Demasiadas solicitudes de autenticación. Intentá en un minuto." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  skip: (req) => req.path === "/health",
});

// límite para conexiones SSE: máximo 10 por usuario por minuto
const sseLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "Demasiadas conexiones SSE. Intentá en un minuto." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKeyGenerator,
});

// límite para mensajes: máximo 60 por usuario por minuto
const messagesLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: "Demasiados mensajes. Intentá en un minuto." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKeyGenerator,
});

function createConcurrencyLimiter({ getLimit, keyGenerator, message }) {
  const active = new Map();

  function release(key) {
    const current = active.get(key);
    if (!current) return;
    if (current <= 1) active.delete(key);
    else active.set(key, current - 1);
  }

  return function concurrencyLimiter(req, res, next) {
    const auth = req.auth;
    // El token master es administración y no consume la cuota de un tenant.
    // Los requests protegidos siempre tienen owner; el apiKeyId queda como
    // fallback defensivo para keys antiguas o datos incompletos.
    if (auth?.master) return next();

    const key = keyGenerator(req);
    const limit = getLimit();

    if (!key || active.has(key) && active.get(key) >= limit) {
      res.setHeader("Retry-After", "1");
      return res.status(429).json({ error: message });
    }

    active.set(key, (active.get(key) || 0) + 1);
    let released = false;

    const releaseOnce = () => {
      if (released) return;
      released = true;
      release(key);
    };

    res.once("finish", releaseOnce);
    res.once("close", releaseOnce);
    return next();
  };
}

const tenantKeyGenerator = (req) =>
  req.auth?.owner
    ? `owner:${req.auth.owner}`
    : req.auth?.apiKeyId
      ? `api-key:${req.auth.apiKeyId}`
      : null;

const tenantRequestConcurrencyLimiter = createConcurrencyLimiter({
  getLimit: () => getConfig().server.tenantMaxConcurrentRequests,
  keyGenerator: tenantKeyGenerator,
  message: "Límite de solicitudes simultáneas para este tenant alcanzado.",
});

const tenantSseConcurrencyLimiter = createConcurrencyLimiter({
  getLimit: () => getConfig().server.tenantMaxSseSessions,
  keyGenerator: tenantKeyGenerator,
  message: "Límite de sesiones SSE simultáneas para este tenant alcanzado.",
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

  const requests = Array.isArray(req.body) ? req.body : [req.body];
  for (const request of requests) {
    const params = request?.params;
    const isToolCall =
      request?.method === "tools/call" &&
      params &&
      typeof params === "object" &&
      params.arguments &&
      typeof params.arguments === "object";

    if (!isToolCall) continue;

    const requestedProject = params.arguments.project;
    if (requestedProject !== undefined && requestedProject !== apiKey.project) {
      res.status(403).json({
        error: "Token no autorizado para uno o más proyectos de la solicitud.",
      });
      return false;
    }

    if (requestedProject === undefined) {
      params.arguments.project = apiKey.project;
    }
  }

  return true;
}

/**
 * Autenticación Bearer multi-tenant:
 *  1) /health no requiere token.
 *  2) El token master (MCP_BEARER_TOKEN) da acceso total (compatibilidad/admin);
 *     no tiene owner (owner=null), por lo que las tools no filtran por usuario.
 *  3) Los tokens de la tabla api_keys dan acceso a su proyecto y aislaron los
 *     datos por su owner. El owner NUNCA se recibe del request: se deriva del
 *     token autenticado y se propaga a las tools mediante AsyncLocalStorage.
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

  try {
    const expectedToken = getConfig().server.bearerToken;
    if (expectedToken && tokensMatch(Buffer.from(expectedToken), Buffer.from(token))) {
      // token master: acceso total, sin scope ni owner
      req.auth = { scope: null, master: true, owner: null, apiKeyId: null };
      return runWithAuth(req.auth, next);
    }

    const apiKey = await findByTokenHash(hashToken(token));
    if (!apiKey || !apiKey.enabled) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    req.auth = {
      scope: apiKey.project || null,
      master: false,
      apiKeyId: apiKey.id,
      owner: apiKey.owner,
    };

    if (!scopeProject(req, res, apiKey)) {
      return;
    }

    touchApiKey(apiKey.id);
    return runWithAuth(req.auth, next);
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
  app.use(validateMcpHostOrigin);
  app.use(authLimiter);
  app.use(requireBearerToken);
  app.use("/sse", sseLimiter);
  app.use("/sse", tenantSseConcurrencyLimiter);
  app.use("/messages", messagesLimiter);
  app.use("/messages", tenantRequestConcurrencyLimiter);
  app.use("/mcp", messagesLimiter);
  app.use("/mcp", tenantRequestConcurrencyLimiter);
  app.use(requireJson);
}

module.exports = {
  authLimiter,
  validateMcpHostOrigin,
  sseLimiter,
  messagesLimiter,
  tenantRequestConcurrencyLimiter,
  tenantSseConcurrencyLimiter,
  createConcurrencyLimiter,
  requireBearerToken,
  requireJson,
  applyMiddleware,
};