// Adaptador de memoria contra Engram local.
// Lectura: API HTTP (GET /health, GET /search).
// Escritura: CLI `engram save` (la API HTTP local no expone un endpoint de
// escritura). memoryPromote solo habla con este adaptador: aquí vive toda la
// lógica específica de Engram.

const childProcess = require("child_process");
const DEFAULT_BASE_URL = "http://127.0.0.1:7437";

/**
 * Resuelve la URL base de Engram local sin depender de ningún secret:
 * ENGRAM_HTTP_URL > ENGRAM_PORT > default.
 * @returns {string} URL base del servidor HTTP de Engram.
 */
function defaultBaseUrl() {
  if (process.env.ENGRAM_HTTP_URL) return process.env.ENGRAM_HTTP_URL;
  if (process.env.ENGRAM_PORT) return `http://127.0.0.1:${process.env.ENGRAM_PORT}`;
  return DEFAULT_BASE_URL;
}

class EngramLocalAdapter {
  /**
   * @param {Object} [options]
   * @param {string} [options.baseUrl] - URL base del servidor HTTP de Engram.
   * @param {Function} [options.fetchFn] - Implementación de fetch (inyectable para tests).
   */
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || defaultBaseUrl();
    this.fetchFn = options.fetchFn || globalThis.fetch;
  }

  get provider() {
    return "engram-local";
  }

  /**
   * Consulta la disponibilidad del servicio (GET /health).
   * NUNCA lanza: devuelve { available: false } ante cualquier fallo de transporte o HTTP.
   * @returns {Promise<Object>} Estado del proveedor.
   */
  async getStatus() {
    if (typeof this.fetchFn !== "function") {
      return { available: false, provider: this.provider, error: "fetch no disponible en el runtime" };
    }
    try {
      const res = await this.fetchFn(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) {
        return { available: false, provider: this.provider, error: `HTTP ${res.status}` };
      }
      const data = await res.json();
      if (!data || data.status !== "ok") {
        return { available: false, provider: this.provider, error: "Engram respondió un estado inesperado" };
      }
      return { available: true, provider: this.provider, version: data.version };
    } catch (err) {
      return { available: false, provider: this.provider, error: err.message };
    }
  }

  /**
   * Busca memorias existentes similares a una consulta (GET /search).
   * LANZA ante errores de transporte o HTTP: el auditor marca pendiente porque
   * no puede contrastar. Devuelve [] cuando no hay resultados (null en la API).
   * @param {Object} params
   * @param {string} params.query - Texto a buscar.
   * @param {string} [params.project] - Filtra por proyecto.
   * @param {number} [params.limit] - Cantidad máxima de resultados.
   * @returns {Promise<Array>} Memorias normalizadas.
   */
  async searchRelated({ query, project, limit = 5 }) {
    if (typeof this.fetchFn !== "function") {
      throw new Error("fetch no disponible en el runtime");
    }
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (project) params.set("project", project);
    if (limit) params.set("limit", String(limit));

    let res;
    try {
      res = await this.fetchFn(`${this.baseUrl}/search?${params.toString()}`, {
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      throw new Error(`Engram search no disponible: ${err.message}`);
    }
    if (!res.ok) {
      throw new Error(`Engram search falló: HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map(normalizeObservation);
  }

  /**
   * Crea la memoria en Engram local invocando el CLI `engram save`.
   * Traduce el candidato interno al formato del proveedor (título, contenido
   * estructurado What/Why/Where/Learned, tipo y proyecto).
   * LANZA ante errores del CLI o si no se puede interpretar la respuesta.
   * @param {Object} candidate - Candidato normalizado a promover.
   * @param {string} candidate.project - Proyecto destino en Engram.
   * @param {string} candidate.title - Título de la memoria.
   * @param {string} [candidate.type] - Tipo observación (decision, discovery...).
   * @param {string} [candidate.topicKey] - Topic key (si el candidato lo tiene).
   * @param {string} [candidate.what]
   * @param {string} [candidate.why]
   * @param {string} [candidate.whereContext]
   * @param {string} [candidate.learned]
   * @returns {Promise<{id: string, topicKey: string|null}>} Identificador devuelto por el proveedor.
   */
  async promote(candidate = {}) {
    const title = String(candidate.title || "").trim();
    if (!title) throw new Error("No se puede promover un candidato sin título");

    const content = buildCandidateContent(candidate);
    const args = [
      "save",
      title,
      content || title,
      "--type",
      candidate.type || "manual",
      "--project",
      String(candidate.project || "default"),
    ];
    if (candidate.topicKey) args.push("--topic", String(candidate.topicKey));

    let output;
    try {
      output = await runEngram(args);
    } catch (err) {
      throw new Error(`Engram save falló: ${err.message}`);
    }
    const match = /Memory saved:\s*#(\d+)/.exec(output);
    if (!match) {
      throw new Error(`Respuesta inesperada de Engram save: ${output.trim().slice(0, 120)}`);
    }
    return { id: match[1], topicKey: candidate.topicKey || null };
  }
}

/**
 * Compone el contenido estructurado (formato What/Why/Where/Learned) que el
 * CLI `engram save` espera como cuerpo de la observación.
 * @param {Object} candidate
 * @returns {string}
 */
function buildCandidateContent(candidate) {
  const parts = [
    ["What", candidate.what],
    ["Why", candidate.why],
    ["Where", candidate.whereContext],
    ["Learned", candidate.learned],
  ].filter(([, value]) => value && String(value).trim());
  return parts.map(([label, value]) => `**${label}**: ${String(value).trim()}`).join("\n");
}

/**
 * Ejecuta el binario `engram` (resuelto por PATH) sin shell intermedio.
 * Usa child_process.execFile para evitar interpretación de caracteres especiales.
 * @param {string[]} args
 * @param {Object} [options]
 * @returns {Promise<string>} stdout del proceso.
 */
function runEngram(args, { timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(
      "engram",
      args,
      { maxBuffer: 1024 * 1024, timeout, windowsHide: true, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr ? stderr.trim() : error.message));
          return;
        }
        resolve(stdout || "");
      }
    );
  });
}

/**
 * Normaliza una observación de Engram al contrato interno del auditor.
 * Engram no expone topic_key por /search: se conserva como null (se completará
 * en la etapa de promoción).
 * @param {Object} row - Observación cruda de Engram.
 * @returns {Object} Memoria normalizada.
 */
function normalizeObservation(row) {
  return {
    id: row.sync_id || String(row.id),
    localId: row.id != null ? String(row.id) : null,
    syncId: row.sync_id || null,
    topicKey: row.topic_key || null,
    type: row.type || null,
    title: row.title || "",
    content: row.content || "",
    project: row.project || null,
    scope: row.scope || null,
    rank: typeof row.rank === "number" ? row.rank : null,
  };
}

module.exports = { EngramLocalAdapter, defaultBaseUrl };