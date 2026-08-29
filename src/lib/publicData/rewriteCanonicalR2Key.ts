/**
 * Public R2 keys embed the requested target id (`videos/{id}.json`,
 * `users/{id}/works/p1.json`). After a visibility probe resolves an alias
 * (YouTube id → canonical video id), rewrite only matching path segments so
 * the canonical object can be read before degraded D1.
 */
function isUnsafePublicTargetId(id: string): boolean {
  if (!id || id.trim() !== id) return true;
  if (id.includes("/") || id.includes("\\")) return true;
  if (id.includes("..")) return true;
  if (/[\x00-\x1f\x7f]/.test(id)) return true;
  return false;
}

function isUnsafePublicR2Key(r2Key: string): boolean {
  if (!r2Key || r2Key.includes("\\") || r2Key.includes("..")) return true;
  return r2Key.split("/").some((part) => !part);
}

export function rewriteCanonicalR2Key(
  r2Key: string,
  requestedTargetId: string,
  canonicalTargetId: string,
): string | null {
  if (!requestedTargetId || requestedTargetId === canonicalTargetId) {
    return null;
  }
  if (
    isUnsafePublicR2Key(r2Key) ||
    isUnsafePublicTargetId(requestedTargetId) ||
    isUnsafePublicTargetId(canonicalTargetId)
  ) {
    return null;
  }
  const parts = r2Key.split("/");
  let replaced = false;
  const next = parts.map((part) => {
    const jsonSuffix = part.endsWith(".json") ? ".json" : "";
    const base = jsonSuffix ? part.slice(0, -".json".length) : part;
    if (base === requestedTargetId) {
      replaced = true;
      return `${canonicalTargetId}${jsonSuffix}`;
    }
    return part;
  });
  return replaced ? next.join("/") : null;
}
