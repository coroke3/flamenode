import {
  validateVideoMemberSubmission,
  type ValidatedMemberSubmission,
} from "./memberSubmission.ts";

export type UnslottedEventSyncErrorCode =
  | "unslotted_event_selection_invalid"
  | "unslotted_event_not_allowed";

export class UnslottedEventSyncError extends Error {
  // Node 22 --experimental-strip-types cannot execute TS parameter properties.
  readonly code: UnslottedEventSyncErrorCode;

  constructor(code: UnslottedEventSyncErrorCode) {
    super(code);
    this.code = code;
    this.name = "UnslottedEventSyncError";
  }
}

/** A single event ID is <=64 characters. Allow ample legacy duplicate tokens
 * (the 30,000-token regression remains valid) but reject unbounded comma runs
 * before iterating. An 8-MiB multipart cap alone permits millions of loops.
 * This intentionally narrows malformed/redundant oversized CURRENT inputs;
 * approval and runtime CPU parity remain separate migration gates.
 */
export const MAX_UNSLOTTED_EVENT_SELECTION_CHARS = 256 * 1024;

/** 枠なし投稿専用。event_ids の汎用複数選択形式を0件または1件へ縮約する。 */
export function parseUnslottedEventIdFromForm(formData: FormData): string | null {
  // Reject repeated form keys instead of silently picking the first value.
  // CURRENT and the transport DTO may otherwise interpret different event IDs
  // from the same multipart request. Iterate without allocating getAll arrays.
  let raw: FormDataEntryValue | null = null;
  let seen = false;
  for (const [key, value] of formData) {
    if (key !== "event_ids") continue;
    if (seen) {
      throw new UnslottedEventSyncError("unslotted_event_selection_invalid");
    }
    seen = true;
    raw = value;
  }
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") {
    throw new UnslottedEventSyncError("unslotted_event_selection_invalid");
  }

  if (raw.length > MAX_UNSLOTTED_EVENT_SELECTION_CHARS) {
    throw new UnslottedEventSyncError("unslotted_event_selection_invalid");
  }

  // This field selects at most one distinct event. Avoid materializing an
  // unbounded array of comma-separated inputs (and a second Set allocation).
  let selected: string | null = null;
  let cursor = 0;
  while (cursor <= raw.length) {
    const comma = raw.indexOf(",", cursor);
    const end = comma === -1 ? raw.length : comma;
    const value = raw.slice(cursor, end).trim();
    if (value.length > 64 || (value && selected !== null && value !== selected)) {
      throw new UnslottedEventSyncError("unslotted_event_selection_invalid");
    }
    if (value && selected === null) selected = value;
    if (comma === -1) break;
    cursor = comma + 1;
  }
  return selected;
}


// SA-086: the scalar fields used by CURRENT parseVideoForm / FormData.get().
// Object.fromEntries(formData) is last-wins, whereas get() is first-wins.
// On the future Hono route, reject ambiguous multipart scalars before either
// representation can be interpreted or an icon/DB write is prepared.
// event_ids and members_json have their own validators and error messages;
// custom-question answers use separately defined dynamic field names.
const UNSLOTTED_SINGLE_VALUE_FIELDS = new Set([
  "active_x_snapshot", "scheduled_time", "youtube_url", "display_name",
  "creator_x_user_id", "icon_mode", "icon_url", "icon_file",
  "profile_text", "youtube_channel_url", "other_social_links",
  "title", "music", "music_reference_url", "credit",
  "intro_comment", "highlights", "production_story", "used_software",
  "closing_comment", "is_collab", "part",
]);

/**
 * Candidate Hono SA-086 multipart preflight; not yet mounted. Normal forms
 * are unchanged. This deliberately fails closed for repeated scalar keys,
 * unlike CURRENT's implicit first/last-wins ambiguity; require parity/Lead
 * acceptance and exact-head CI before enabling it in a route.
 */
export function validateUniqueUnslottedVideoScalarFields(
  formData: FormData,
): { ok: true } | { ok: false; message: string } {
  const seen = new Set<string>();
  for (const [key] of formData) {
    if (!UNSLOTTED_SINGLE_VALUE_FIELDS.has(key)) continue;
    if (seen.has(key)) {
      return { ok: false, message: "投稿フォームの入力が不正です。" };
    }
    seen.add(key);
  }
  return { ok: true };
}


/**
 * Pure SA-086 multipart preflight for the future Hono handler. The result is
 * deliberately limited to validated event selection + member/chapter input;
 * it does NOT authorize the caller, validate the full video form, read D1,
 * upload files or write audit/Queue rows. Call it only after the size and
 * session/write guards and before any storage mutation.
 *
 * CURRENT delegates event/member checks separately, with event selection
 * taking precedence over member errors. The new scalar-duplicate rejection
 * is an intentional Hono contract tightening pending Lead parity approval.
 */
export function validateFreeVideoMultipartPreflight(
  formData: FormData,
  isCollab: boolean,
):
  | { ok: true; value: { requestedEventId: string | null; memberSubmission: ValidatedMemberSubmission } }
  | { ok: false; message: string } {
  const unique = validateUniqueUnslottedVideoScalarFields(formData);
  if (!unique.ok) return unique;

  let requestedEventId: string | null;
  try {
    requestedEventId = parseUnslottedEventIdFromForm(formData);
  } catch {
    // Match CURRENT SA-086's user-facing event error; never disclose a raw
    // File object, input, parser stack, or provider diagnostic.
    return { ok: false, message: "枠なし投稿で所属できるイベントは1件までです。" };
  }

  const memberValidation = validateVideoMemberSubmission(formData, isCollab);
  if (!memberValidation.ok) return memberValidation;

  return {
    ok: true,
    value: { requestedEventId, memberSubmission: memberValidation.value },
  };
}
