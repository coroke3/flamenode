/**
 * MIG-0727 U02b: CURRENT AnnouncementForm -> already-mounted SA-004..006 Hono API.
 * Reuse shared input validation and transport contracts; no new mutation routes.
 */
import {
  AnnouncementResultSchema,
  AnnouncementWriteBodySchema,
  AdminAnnouncementDetailResponseSchema,
  type AdminAnnouncementDetailResponse,
  type AnnouncementResultDto,
  type AnnouncementWriteBody,
} from "@flamenode/contracts";
import { validateAnnouncementInput } from "@flamenode/domain/announcements";
import { getJson, type OpsFetch, type OpsResult } from "./read.js";
import { send } from "./write.js";

const defaultFetch: OpsFetch = (path, init) => fetch(path, init);
const BASE = "/api/admin/announcements";
const READ_BASE = "/api/admin-read/announcements";
const INVALID_INPUT = "入力内容を確認してください。";
const TRANSPORT_FAILURE = "保存に失敗しました。再読み込みして、もう一度お試しください。";

function validInput(raw: Record<string, unknown>): AnnouncementWriteBody | { ok: false; message: string } {
  const shape = AnnouncementWriteBodySchema.safeParse(raw);
  if (!shape.success) return { ok: false, message: INVALID_INPUT };
  const checked = validateAnnouncementInput(shape.data);
  if (!checked.ok) return checked;
  return shape.data;
}

async function write(
  method: "POST" | "PUT" | "DELETE",
  path: string,
  body: AnnouncementWriteBody | undefined,
  fetchFn: OpsFetch,
): Promise<AnnouncementResultDto> {
  const response = await send<AnnouncementResultDto>(fetchFn, method, path, body);
  if (response.status === "anonymous") return { ok: false, message: "ログインしてください。" };
  if (response.status !== "ok") return { ok: false, message: TRANSPORT_FAILURE };
  const checked = AnnouncementResultSchema.safeParse(response.data);
  return checked.success ? checked.data : { ok: false, message: TRANSPORT_FAILURE };
}

export async function readAnnouncementDetail(
  id: string,
  fetchFn: OpsFetch = defaultFetch,
  signal?: AbortSignal,
): Promise<OpsResult<AdminAnnouncementDetailResponse>> {
  if (!id) return { status: "notFound" };
  const response = await getJson<unknown>(fetchFn, READ_BASE + "/" + encodeURIComponent(id), signal);
  if (response.status !== "ok") return response;
  const checked = AdminAnnouncementDetailResponseSchema.safeParse(response.data);
  return checked.success && checked.data.item.id === id
    ? { status: "ok", data: checked.data }
    : { status: "unavailable" };
}

export function createAdminAnnouncementsApi(fetchFn: OpsFetch = defaultFetch) {
  return {
    read: (id: string, signal?: AbortSignal) => readAnnouncementDetail(id, fetchFn, signal),
    create: (raw: Record<string, unknown>) => {
      const body = validInput(raw);
      return "ok" in body && body.ok === false
        ? Promise.resolve(body)
        : write("POST", BASE, body as AnnouncementWriteBody, fetchFn);
    },
    update: (id: string, raw: Record<string, unknown>) => {
      if (!id) return Promise.resolve({ ok: false, message: "お知らせIDが必要です。" });
      const body = validInput({ ...raw, id });
      return "ok" in body && body.ok === false
        ? Promise.resolve(body)
        : write("PUT", BASE + "/" + encodeURIComponent(id), body as AnnouncementWriteBody, fetchFn);
    },
    delete: (id: string) => id
      ? write("DELETE", BASE + "/" + encodeURIComponent(id), undefined, fetchFn)
      : Promise.resolve({ ok: false, message: "お知らせIDが必要です。" }),
  };
}
