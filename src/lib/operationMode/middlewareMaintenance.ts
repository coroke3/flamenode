import {
  OPERATION_MODE_KV_KEY,
  parseOperationModeKvMirror,
} from "./kvMirrorCore";

/**
 * Edge middleware 向けメンテナンス判定。
 * 優先: MAINTENANCE_MODE env → KV operation_mode ミラー。
 */
export async function resolveMiddlewareMaintenance(): Promise<boolean> {
  if (process.env.MAINTENANCE_MODE === "1") return true;

  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const kv = getCloudflareContext().env.KV;
    if (!kv) return false;
    const raw = await kv.get(OPERATION_MODE_KV_KEY);
    const mirror = parseOperationModeKvMirror(raw);
    return mirror?.mode === "maintenance";
  } catch {
    return false;
  }
}
