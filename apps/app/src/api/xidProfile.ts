/** MIG-0708 U02/U04: mounted Personal X ID mutation transport using the canonical Hono contract. */
import { XIdWriteResultSchema, type XIdWriteResult } from "@flamenode/contracts";

export type XidProfileResult = XIdWriteResult;
export type ProfileFields = {
  x_name: string;
  profile_text: string;
  portfolio_contact: string;
  youtube_channel_url: string;
  other_social_links: string;
};
export interface XidProfileApi {
  setActive(xUserId: string): Promise<XidProfileResult>;
  updateProfile(xUserId: string, fields: ProfileFields): Promise<XidProfileResult>;
  deleteXId(xUserId: string, confirm: string): Promise<XidProfileResult>;
  setIcon(xUserId: string, iconUrl: string): Promise<XidProfileResult>;
  uploadIcon(xUserId: string, file: File): Promise<XidProfileResult>;
}
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
const jsonHeaders = { accept: "application/json", "content-type": "application/json" } as const;
const INVALID = { ok: false } as const;
// The outer multipart request limit is 8 MiB. The Hono handler independently
// caps the converted icon file itself at 2 MiB (SA-105).
const MAX_ICON_BYTES = 2 * 1024 * 1024;
const ALLOWED_ICON_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

async function request(
  fetchFn: FetchLike,
  method: "POST" | "PATCH" | "DELETE" | "PUT",
  path: string,
  body: Record<string, string> | FormData,
): Promise<XidProfileResult> {
  const isMultipart = body instanceof FormData;
  let response: Response;
  try {
    response = await fetchFn(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: isMultipart ? { accept: "application/json" } : jsonHeaders,
      body: isMultipart ? body : JSON.stringify(body),
    });
  } catch {
    // Do not expose network/provider errors or falsely report a successful write.
    return INVALID;
  }
  let value: unknown;
  try { value = await response.json(); }
  catch { return INVALID; }
  const parsed = XIdWriteResultSchema.safeParse(value);
  if (!parsed.success) return INVALID;
  // Do not trust an HTTP error's ok:true envelope. Preserve the canonical reason
  // for a valid failed response, but never leak provider exception text.
  return response.ok ? parsed.data : {
    ok: false,
    message: parsed.data.message,
    ...(parsed.data.reason === undefined ? {} : { reason: parsed.data.reason }),
  };
}
const xPath = (id: string) => "/api/xid/" + encodeURIComponent(id);

export function createXidProfileApi(
  fetchFn: FetchLike = (input, init) => fetch(input, init),
): XidProfileApi {
  return {
    setActive: (id) => request(fetchFn, "POST", "/api/xid/active", { x_user_id: id }),
    updateProfile: (id, fields) => request(fetchFn, "PATCH", xPath(id) + "/profile", fields),
    deleteXId: (id, confirm) => confirm === "DELETE " + id
      ? request(fetchFn, "DELETE", xPath(id), { confirm })
      : Promise.resolve(INVALID),
    setIcon: (id, iconUrl) => request(fetchFn, "PUT", xPath(id) + "/icon", { icon_url: iconUrl }),
    uploadIcon: (id, file) => {
      // Component accept/size checks can be bypassed by direct API callers.
      // Never transmit unsupported or oversized data even before server validation.
      if (!ALLOWED_ICON_MIME.has(file.type) || file.size === 0 || file.size > MAX_ICON_BYTES) {
        return Promise.resolve(INVALID);
      }
      const fd = new FormData();
      fd.set("icon_file", file);
      return request(fetchFn, "POST", xPath(id) + "/icon/upload", fd);
    },
  };
}
