/**
 * MIG-0636 U05: validated routing inputs shared by future SA-102..104 handlers.
 * This module performs no I/O; auth, linked-X approval, icon-candidate checks,
 * CAS, audit and queue mutation MUST happen in the guarded Hono handlers.
 */
import {
  UpdateXIdProfileBodySchema,
  DeleteLinkedXIdBodySchema,
  SetXIdIconBodySchema,
} from "@flamenode/contracts";
import { normalizeXId, isCanonicalXId } from "@flamenode/domain/xid";

type Invalid = { ok: false; message: string };
type Valid<T> = { ok: true; value: T };
type Parsed<T> = Invalid | Valid<T>;

const INVALID_TARGET = "X ID が不正です。";
const MISMATCHED_TARGET = "操作する X ID が一致しません。";
/** Mirror CURRENT src/lib/utils/url.ts: only HTTP(S), no URL credentials, 500 serialized chars. */
function normalizeProfileHttpUrl(raw: string): string | null {
  if (!raw || raw.length > 500) return null;
  try {
    const url = new URL(raw);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
      return null;
    }
    const normalized = url.toString();
    return normalized.length <= 500 ? normalized : null;
  } catch {
    return null;
  }
}

function normalizeProfileContact(raw: string): string | null {
  const value = raw.slice(0, 1200).trim();
  return !value || value.toLowerCase() === "portfolio_contact" ? null : value;
}


function matchTarget(pathXId: string, bodyXId: string): Parsed<string> {
  // Unlike normalization of display handles, a URL route must be canonical.
  // Reject slash, percent-decoded separators, aliases and non-X user identifiers
  // before any privileged D1 read or mutation.
  if (!isCanonicalXId(pathXId)) return { ok: false, message: INVALID_TARGET };
  if (normalizeXId(bodyXId) !== pathXId) {
    return { ok: false, message: MISMATCHED_TARGET };
  }
  return { ok: true, value: pathXId };
}

export function parseXIdProfileInput(pathXId: string, json: unknown): Parsed<{
  xUserId: string;
  xName: string;
  profileText: string;
  portfolioContact: string | null;
  youtubeChannelUrl: string | null;
  otherSocialLinksRaw: string;
}> {
  const parsed = UpdateXIdProfileBodySchema.safeParse(json);
  if (!parsed.success) return { ok: false, message: "入力内容を確認してください。" };
  const target = matchTarget(pathXId, parsed.data.x_user_id);
  if (!target.ok) return target;
  const youtubeRaw = (parsed.data.youtube_channel_url ?? "").trim();
  const youtubeChannelUrl = youtubeRaw ? normalizeProfileHttpUrl(youtubeRaw) : null;
  if (youtubeRaw && !youtubeChannelUrl) {
    return { ok: false, message: "YouTube チャンネル URL が不正です。" };
  }
  // CURRENT social link JSON normalization is still separate and mandatory
  // before any later route is allowed to write. This pure parser does no I/O.
  return { ok: true, value: {
    xUserId: target.value,
    xName: (parsed.data.x_name ?? "").trim().slice(0, 80),
    profileText: (parsed.data.profile_text ?? "").trim().slice(0, 2000),
    portfolioContact: normalizeProfileContact(parsed.data.portfolio_contact ?? ""),
    youtubeChannelUrl,
    otherSocialLinksRaw: (parsed.data.other_social_links ?? "").trim(),
  } };
}

export function parseDeleteLinkedXInput(pathXId: string, json: unknown): Parsed<string> {
  const parsed = DeleteLinkedXIdBodySchema.safeParse(json);
  if (!parsed.success) return { ok: false, message: "入力内容を確認してください。" };
  const target = matchTarget(pathXId, parsed.data.x_user_id);
  if (!target.ok) return target;
  if (parsed.data.confirm.trim() !== `DELETE ${target.value}`) {
    return { ok: false, message: `確認のため DELETE ${target.value} と入力してください。` };
  }
  return target;
}

export function parseSetXIdIconInput(pathXId: string, json: unknown): Parsed<{
  xUserId: string; iconUrl: string;
}> {
  const parsed = SetXIdIconBodySchema.safeParse(json);
  if (!parsed.success) return { ok: false, message: "入力内容を確認してください。" };
  const target = matchTarget(pathXId, parsed.data.x_user_id);
  if (!target.ok) return target;
  const iconUrl = parsed.data.icon_url.trim();
  if (!iconUrl) return { ok: false, message: "X ID とアイコンが必要です。" };
  // This is NOT authorization to use iconUrl. Only an audited server-side
  // candidate lookup can grant permission for the caller's linked X account.
  return { ok: true, value: { xUserId: target.value, iconUrl } };
}
