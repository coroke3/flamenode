/** MIG-0708 U02: provisional Personal X ID mutation transport (D-16-1).
 * No NEXT / Auth.js / D1 imports. Before MIG-0636 merges, keep this client
 * unmounted; migrate the response contract to @flamenode/contracts/xid at U04.
 */
export interface XidProfileResult {
  ok: boolean;
  message?: string;
  iconUrl?: string;
}
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

function isXidResult(value: unknown): value is XidProfileResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.ok === "boolean"
    && (record.message === undefined || typeof record.message === "string")
    && (record.iconUrl === undefined || typeof record.iconUrl === "string");
}

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
  if (!isXidResult(value)) return INVALID;
  // HTTP error must not be converted to success by a stale/malformed JSON body.
  return response.ok ? value : { ok: false, message: value.message };
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
      const fd = new FormData();
      fd.set("icon_file", file);
      return request(fetchFn, "POST", xPath(id) + "/icon/upload", fd);
    },
  };
}
