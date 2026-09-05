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
   * Promueve un candidato AUDITADO creando (o reutilizando) la memoria en Engram
   * local mediante el CLI `engram save`. Traduce el candidato interno al formato
   * del proveedor (título, contenido estructurado What/Why/Where/Learned, tipo,
   * proyecto y topic opcional).
   *
   * Contrato MemoryAdapter.promote:
   *   - NUNCA lanza excepciones del proveedor: devuelve un PromoteResult.
   *   - Éxito: { success: true, memoryId, topicKey, metadata }.
   *   - Fallo: { success: false, error, retryable }.
   *   - No escribe en memory_candidates ni en Neon.
   *
   * @param {MemoryCandidate} candidate - Candidato auditado a promover.
   * @param {PromoteOptions} [options] - Opciones del contrato. Engram local no
   *   implementa idempotencia nativa, así que idempotencyKey se acepta pero no
   *   se mapea a ningún flag del CLI (el find-before-create evita duplicados).
   * @returns {Promise<PromoteResult>} Resultado normalizado.
   */
  async promote(candidate = {}, _options = {}) {
    const title = String(candidate.title || "").trim();
    if (!title) {
      return {
        success: false,
        error: "Candidato inválido: el título es requerido",
        retryable: false,
      };
    }

    const existing = await this.findExistingMemory(candidate);
    if (existing) {
      return {
        success: true,
        memoryId: existing.id,
        topicKey: existing.topicKey,
        metadata: {},
      };
    }

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
      return {
        success: false,
        error: `Engram save falló: ${err.message}`,
        retryable: isRetryableProviderError(err.message),
      };
    }
    const match = /Memory saved:\s*#(\d+)/.exec(output);
    if (!match) {
      return {
        success: false,
        error: `Respuesta inesperada de Engram save: ${output.trim().slice(0, 120)}`,
        retryable: false,
      };
    }
    return {
      success: true,
      memoryId: match[1],
      topicKey: candidate.topicKey || null,
      metadata: {},
    };
  }

  /**
   * Localiza una memoria ya existente en el proveedor que represente exactamente
   * este candidato (mismo título normalizado en el mismo proyecto y tipo), para
   * reutilizarla y no crear un duplicado tras un reintento.
   * Best-effort: si la búsqueda falla devuelve null y el flujo sigue a la
   * creación normal.
   * @param {Object} candidate - Candidato normalizado a promover.
   * @returns {Promise<{id: string, topicKey: string|null}|null>} Memoria existente o null.
   */
  async findExistingMemory(candidate) {
    const title = String(candidate.title || "").trim();
    if (!title) return null;

    let memories;
    try {
      memories = await this.searchRelated({ query: title, project: candidate.project, limit: 10 });
    } catch {
      return null;
    }
    const targetType = candidate.type ? String(candidate.type).trim() : null;
    const normalizedTitle = normalizeTitle(title);
    for (const memory of memories) {
      if (normalizeTitle(memory.title) !== normalizedTitle) continue;
      if (targetType && memory.type && String(memory.type) !== targetType) continue;
      if (memory.id == null) continue;
      return { id: memory.id, topicKey: candidate.topicKey || null };
    }
    return null;
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
 * Normaliza un título para comparar coincidencias exactas (caso/espacios).
 * @param {string} value
 * @returns {string}
 */
function normalizeTitle(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Clasifica un error del proceso `engram` como retryable o permanente.
 * Retryable: el fallo es externo y temporal (timeout, conexión, crash del daemon).
 * Permanente: el entorno está mal configurado y reintentar no ayudará
 * (binario ausente, comando no reconocido, permisos).
 * @param {string} message - Mensaje del error del CLI.
 * @returns {boolean} true si reintentar puede resolver el fallo.
 */
function isRetryableProviderError(message) {
  const detailed = String(message || "");
  const permanent = /ENOENT|EACCES|EPERM|command not found|not recognized|no such file|is not recognized/i;
  return !permanent.test(detailed);
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