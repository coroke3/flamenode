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


/** CURRENT src/lib/socialLinks.ts#validateSocialLinksJson, transport-only parity. */
function socialType(raw: unknown): string {
  const truncated = String(raw ?? "").trim().slice(0, 40);
  const type = /[\uD800-\uDBFF]$/.test(truncated) ? truncated.slice(0, -1) : truncated;
  const key = type.toLowerCase();
  const aliases: Record<string, string> = {
    twitter: "X", x: "X", instagram: "Instagram", insta: "Instagram",
    tiktok: "TikTok", bluesky: "Bluesky", bsky: "Bluesky",
    niconico: "Niconico", nico: "Niconico", "ニコニコ": "Niconico",
    portfolio: "Portfolio", tumblr: "Tumblr", tumbler: "Tumblr",
    discord: "Discord", email: "Email", mail: "Email",
    web: "Website", website: "Website", site: "Website",
  };
  return Object.prototype.hasOwnProperty.call(aliases, key) ? aliases[key]! : (type || "Other");
}

function profileSocialUrl(raw: unknown, type: string): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (type === "Email") {
    const address = value.replace(/^mailto:/i, "").split("?")[0]?.trim() ?? "";
    return address && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)
      ? `mailto:${address}` : null;
  }
  if (/^mailto:/i.test(value)) return null;
  if (!value.includes("://") && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null;
  return normalizeProfileHttpUrl(value);
}

function validateProfileSocialLinks(raw: string): Parsed<string | null> {
  const text = raw.trim();
  if (!text) return { ok: true, value: null };
  if (text.length > 5000) return { ok: false, message: "SNSリンクが長すぎます。" };
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { return { ok: false, message: "SNSリンクのJSON形式が不正です。" }; }
  if (!Array.isArray(parsed)) {
    return { ok: false, message: "SNSリンクは配列形式で保存してください。" };
  }
  const links: Array<{ type: string; url: string }> = [];
  for (const item of parsed) {
    if (links.length >= 8) break;
    if (!item || typeof item !== "object") continue;
    const row = item as { type?: unknown; url?: unknown };
    if (!String(row.url ?? "").trim()) continue;
    const type = socialType(row.type);
    const url = profileSocialUrl(row.url, type);
    if (!url) {
      return { ok: false, message: "SNSリンクには、Email はメールアドレス、それ以外は http/https の有効なURLを入力してください。" };
    }
    links.push({ type, url });
  }
  return { ok: true, value: links.length ? JSON.stringify(links) : null };
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
  otherSocialLinks: string | null;
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
  const social = validateProfileSocialLinks(parsed.data.other_social_links ?? "");
  if (!social.ok) return social;
  // This parser only validates transport inputs; it cannot grant X ownership.
  return { ok: true, value: {
    xUserId: target.value,
    xName: (parsed.data.x_name ?? "").trim().slice(0, 80),
    profileText: (parsed.data.profile_text ?? "").trim().slice(0, 2000),
    portfolioContact: normalizeProfileContact(parsed.data.portfolio_contact ?? ""),
    youtubeChannelUrl,
    otherSocialLinks: social.value,
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
