const PROJECT_ALIASES = {
  "Authentication-system": "authentication-system",
  "Authentication-System": "authentication-system",
  "mi-portafolio": "portafolio",
  "conversation-memory-mcp": "conversation-memory-mcp",
};

const INVALID_PROJECT = /[\\/]|^[.]{1,2}$/;

export function baseName(path) {
  const parts = String(path || "").split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? String(path || "");
}

export function resolveProjectName(raw) {
  const value = String(raw || "");
  const name = PROJECT_ALIASES[value] ?? value.trim().toLowerCase();
  if (!name || INVALID_PROJECT.test(name)) return "";
  return name;
}

export function resolveProjectIdentity(projectId, fallbackPath) {
  const stableId = typeof projectId === "string" ? projectId.trim() : "";
  if (stableId && !INVALID_PROJECT.test(stableId)) return stableId;
  return resolveProjectName(baseName(fallbackPath));
}
