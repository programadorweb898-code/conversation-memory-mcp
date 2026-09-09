const crypto = require('crypto');
const { db } = require('../database');

/**
 * Hash SHA-256 hex de un token. Solo se persiste el hash, nunca el token plano.
 * @param {string} token
 * @returns {string}
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Busca una api_key por su token plano. Devuelve null si no existe.
 * @param {string} token
 * @returns {Promise<object|null>}
 */
async function findByToken(token) {
  return db.getAsync('SELECT * FROM api_keys WHERE token_hash = $1', [hashToken(token)]);
}

/**
 * Busca una api_key por hash (útil desde el middleware sin conocer el token plano).
 * @param {string} tokenHash
 * @returns {Promise<object|null>}
 */
async function findByTokenHash(tokenHash) {
  return db.getAsync('SELECT * FROM api_keys WHERE token_hash = $1', [tokenHash]);
}

/**
 * Crea una api_key: genera un token aleatorio, guarda solo su hash y lo devuelve.
 * El token plano se imprime una única vez y no puede recuperarse después.
 * @param {object} options
 * @param {string} options.name - Identificador del dueño (usuario/dispositivo/agente).
 * @param {string|null} [options.project] - Proyecto al que da acceso o null para todos.
 * @returns {Promise<{token: string, key: object}>}
 */
async function createApiKey({ name, project = null }) {
  const token = crypto.randomBytes(24).toString('base64url');
  const row = {
    id: crypto.randomUUID(),
    token_hash: hashToken(token),
    name,
    project: project || null,
    enabled: true,
  };
  await db.runAsync(
    `INSERT INTO api_keys (id, token_hash, name, project, enabled)
     VALUES ($1, $2, $3, $4, $5)`,
    [row.id, row.token_hash, row.name, row.project, row.enabled]
  );
  return { token, key: row };
}

/**
 * Lista las api_keys sin el hash (que es sensible) para gestión.
 * @returns {Promise<Array<object>>}
 */
async function listApiKeys() {
  const rows = await db.allAsync(
    `SELECT id, name, project, enabled, created_at, last_used_at
     FROM api_keys ORDER BY created_at DESC`
  );
  return rows;
}

/**
 * Revoca una api_key (la deshabilita). Las deshabilitadas se rechazan en auth pero
 * se conservan en la tabla para auditoría.
 * @param {string} id
 * @returns {Promise<object|null>} La key actualizada o null si no existe.
 */
async function revokeApiKey(id) {
  const result = await db.runAsync(
    `UPDATE api_keys SET enabled = FALSE WHERE id = $1`,
    [id]
  );
  if (result.changes === 0) {
    return null;
  }
  return db.getAsync('SELECT * FROM api_keys WHERE id = $1', [id]);
}

/**
 * Registra el último uso del token.
 * @param {string} id
 * @returns {Promise<void>}
 */
async function touchApiKey(id) {
  try {
    await db.runAsync(
      `UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [id]
    );
  } catch (err) {
    console.error('Error actualizando last_used_at:', err.message);
  }
}

module.exports = {
  hashToken,
  findByToken,
  findByTokenHash,
  createApiKey,
  listApiKeys,
  revokeApiKey,
  touchApiKey,
};