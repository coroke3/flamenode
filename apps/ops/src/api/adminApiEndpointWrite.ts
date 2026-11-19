/** MIG-0727 U04: unmounted Ops API-endpoint activation adapter.
 * Existing MIG-0602 SA-007/008 Hono routes own admin writes and auditing.
 */
import {
  ApiEndpointCreateBodySchema, ApiEndpointSetActiveBodySchema,
  ApiEndpointResultSchema,
} from "@flamenode/contracts";
import { validateApiEndpointEventId } from "@flamenode/domain/apiEndpoints";
import type { OpsFetch } from "./read.js";
import { send } from "./write.js";

const defaultFetch: OpsFetch = (path, init) => fetch(path, init);
const BASE = "/api/admin/api-endpoints";
type ApiEndpointResult = { ok: boolean; id?: string; message?: string };
const invalid = (): ApiEndpointResult => ({ ok: false, message: "event_idが不正です。" });
const unavailable = (): ApiEndpointResult => ({ ok: false, message: "公開API設定を更新できませんでした。" });

async function write(fetchFn: OpsFetch, method: "POST" | "PATCH", path: string, body: object): Promise<ApiEndpointResult> {
  const result = await send<ApiEndpointResult>(fetchFn, method, path, body);
  if (result.status === "anonymous") return { ok: false, message: "ログインしてください。" };
  if (result.status !== "ok") return unavailable();
  const parsed = ApiEndpointResultSchema.safeParse(result.data);
  return parsed.success ? parsed.data : unavailable();
}

export function createAdminApiEndpointWriteApi(fetchFn: OpsFetch = defaultFetch) {
  return {
    enable(rawEventId: string): Promise<ApiEndpointResult> {
      const id = validateApiEndpointEventId(rawEventId);
      if (!id.ok) return Promise.resolve(invalid());
      const body = ApiEndpointCreateBodySchema.parse({ event_id: id.eventId });
      return write(fetchFn, "POST", BASE, body);
    },
    setActive(rawEventId: string, enabled: 0 | 1): Promise<ApiEndpointResult> {
      const id = validateApiEndpointEventId(rawEventId);
      if (!id.ok) return Promise.resolve(invalid());
      const shape = ApiEndpointSetActiveBodySchema.safeParse({ public_api_enabled: enabled });
      if (!shape.success || (enabled !== 0 && enabled !== 1)) {
        return Promise.resolve({ ok: false, message: "public_api_enabledが不正です。" });
      }
      return write(fetchFn, "PATCH", BASE + "/" + encodeURIComponent(id.eventId), shape.data);
    },
  };
}
