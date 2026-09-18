// src/context.js
// Propaga el contexto de autenticación (auth) desde el middleware HTTP hacia
// los handlers de las tools MCP mediante AsyncLocalStorage. Así cada tool
// conoce el owner autenticado sin recibirlo en los parámetros públicos (no es
// posible falsificarlo desde el request).
const { AsyncLocalStorage } = require("async_hooks");

const als = new AsyncLocalStorage();

/**
 * Ejecuta `fn` dentro de un contexto con auth.
 * @param {object|null} auth - Contexto de autenticación de req.auth.
 * @param {Function} fn - Callback a ejecutar en el contexto.
 * @returns {*}
 */
function runWithAuth(auth, fn) {
  return als.run({ auth }, fn);
}

/**
 * Devuelve el auth del request HTTP actual, o null si no hay contexto
 * (por ejemplo, en modo stdio/npx no hay autenticación HTTP).
 * @returns {object|null} { scope, master, owner, apiKeyId } o null.
 */
function getAuth() {
  const store = als.getStore();
  return store ? store.auth : null;
}

/**
 * Resuelve el owner con el que se PERSISTE un dato. Nunca devuelve null: las
 * columnas owner son NOT NULL. Si no hay owner autenticado (token master o
 * modo stdio), se usa MCP_DEFAULT_OWNER o el owner local predeterminado.
 * Para LEER, en cambio, se usa el owner crudo de getAuth(): null significa
 * admin y permite ver todos los owners (filtro $x::text IS NULL OR owner=$x).
 * @param {string|undefined} owner - Owner autenticado (lo provee withScope).
 * @returns {string}
 */
function resolveWriteOwner(owner) {
  return owner || process.env.MCP_DEFAULT_OWNER || "local-user";
}

module.exports = { runWithAuth, getAuth, resolveWriteOwner };
