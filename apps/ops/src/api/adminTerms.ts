/** MIG-0727 U03b: CURRENT SA-051..055 terms lifecycle API adapter.
 * Server owns authorization, full-row CAS, long audit and queue writes.
 * Do not mount privileged publish/archive/broadcast controls before reviewed UI parity.
 */
import {
  AdminTermsDraftBodySchema, AdminTermsReacceptBroadcastBodySchema,
  AdminTermsNotificationsResultSchema, type AdminTermsNotificationsResult,
} from "@flamenode/contracts";
import { parseTermsDraftInput, parseTermsReacceptBroadcastInput } from "@flamenode/domain/admin";
import { send } from "./write.js";
import type { OpsFetch } from "./read.js";

const defaultFetch: OpsFetch = (path, init) => fetch(path, init);
const BASE = "/api/admin/terms";
const UNAVAILABLE = "管理操作を処理できませんでした。再度お試しください。";
type Rejected = { ok: false; message: string };
const reject = (message: string): Rejected => ({ ok: false, message });

async function request(
  fetchFn: OpsFetch,
  method: "POST" | "PATCH",
  path: string,
  body?: object,
): Promise<AdminTermsNotificationsResult> {
  const result = await send<AdminTermsNotificationsResult>(fetchFn, method, path, body);
  if (result.status === "anonymous") return reject("ログインしてください。");
  if (result.status !== "ok") return reject(UNAVAILABLE);
  const parsed = AdminTermsNotificationsResultSchema.safeParse(result.data);
  return parsed.success ? parsed.data : reject(UNAVAILABLE);
}

function draft(raw: Record<string, unknown>):
  | { ok: true; body: Record<string, unknown> }
  | Rejected {
  const shape = AdminTermsDraftBodySchema.safeParse(raw);
  if (!shape.success) return reject("入力エラー");
  const checked = parseTermsDraftInput(shape.data);
  if (!checked.ok) return reject(checked.message);
  return { ok: true, body: checked.draft };
}

export function createAdminTermsApi(fetchFn: OpsFetch = defaultFetch) {
  return {
    createDraft(raw: Record<string, unknown>): Promise<AdminTermsNotificationsResult> {
      const body = draft(raw);
      if (!body.ok) return Promise.resolve(body);
      return request(fetchFn, "POST", BASE, body.body);
    },
    updateDraft(id: string, raw: Record<string, unknown>): Promise<AdminTermsNotificationsResult> {
      if (!id) return Promise.resolve(reject("id が必要です。"));
      const body = draft({ ...raw, id });
      if (!body.ok) return Promise.resolve(body);
      return request(fetchFn, "PATCH", BASE + "/" + encodeURIComponent(id), body.body);
    },
    publish(id: string): Promise<AdminTermsNotificationsResult> {
      return id ? request(fetchFn, "POST", BASE + "/" + encodeURIComponent(id) + "/publish")
        : Promise.resolve(reject("id が必要です。"));
    },
    archive(id: string): Promise<AdminTermsNotificationsResult> {
      return id ? request(fetchFn, "POST", BASE + "/" + encodeURIComponent(id) + "/archive")
        : Promise.resolve(reject("id が必要です。"));
    },
    broadcast(id: string, confirm: string, cursor: string, content: string):
      Promise<AdminTermsNotificationsResult> {
      const parsed = parseTermsReacceptBroadcastInput({ termsId: id, confirm, cursor, content });
      if (!parsed.ok) return Promise.resolve(parsed);
      if (!parsed.content) return Promise.resolve(reject("通知内容を入力してください。"));
      const body = AdminTermsReacceptBroadcastBodySchema.parse({
        confirm, cursor: parsed.cursor, content: parsed.content,
      });
      return request(fetchFn, "POST", BASE + "/" + encodeURIComponent(parsed.termsId) + "/reaccept-broadcast", body);
    },
  };
}
