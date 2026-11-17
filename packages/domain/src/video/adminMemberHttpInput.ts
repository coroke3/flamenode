/**
 * MIG-0650 U03d-1: D-16-1 JSON transport -> CURRENT SA-085 FormData keys.
 * This is only a pure, unmounted input adapter. Auth/admin/CostGuard and the
 * D1 video lookup MUST run before invoking the existing member validator.
 * No untrusted JSON body can select a video ID other than the URL parameter.
 */
export type AdminMemberHttpInput =
  | { ok: true; formData: FormData }
  | { ok: false; message: string };

const INVALID_INPUT = "参加者設定の入力が不正です。";
const INVALID_VIDEO_ID = "対象作品が指定されていません。";

/**
 * Use exactly the same URL ID guard before reading the privileged JSON body.
 * Does not grant authorization or access the database.
 */
export function isValidAdminVideoMemberPathId(pathVideoId: unknown): pathVideoId is string {
  if (
    typeof pathVideoId !== "string" ||
    !pathVideoId ||
    pathVideoId.length > 64 ||
    pathVideoId.trim() !== pathVideoId ||
    pathVideoId === "." ||
    pathVideoId === ".." ||
    /[\/\\\x00-\x1f]/.test(pathVideoId)
  ) return false;
  try {
    encodeURIComponent(pathVideoId); // reject malformed UTF-16
    return true;
  } catch {
    return false;
  }
}


/**
 * Keep the legacy literal checkbox semantics: only "on" and "true" turn
 * collaboration on. Multiple checkbox values may be represented as an array.
 * "members_json" remains a string because CURRENT validates its raw JSON
 * value via validateVideoMemberSubmission after the authorized video lookup.
 */
export function parseAdminVideoMembersHttpInput(
  pathVideoId: string,
  raw: unknown,
): AdminMemberHttpInput {
  if (!isValidAdminVideoMemberPathId(pathVideoId)) {
    return { ok: false, message: INVALID_VIDEO_ID };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: INVALID_INPUT };
  }
  const body = raw as Record<string, unknown>;
  const membersJson = body.members_json;
  if (
    Object.keys(body).some((key) => key !== "members_json" && key !== "is_collab") ||
    (membersJson !== undefined && typeof membersJson !== "string")
  ) {
    // D-16-1: path ID is authoritative, even a matching body.video_id is forbidden.
    return { ok: false, message: INVALID_INPUT };
  }
  const checkbox = body.is_collab;
  const values = checkbox === undefined ? [] : Array.isArray(checkbox) ? checkbox : [checkbox];
  if (values.length > 16 || values.some((value) => typeof value !== "string")) {
    return { ok: false, message: INVALID_INPUT };
  }

  const formData = new FormData();
  formData.set("video_id", pathVideoId);
  for (const value of values as string[]) formData.append("is_collab", value);
  if (typeof membersJson === "string") formData.set("members_json", membersJson);
  return { ok: true, formData };
}
