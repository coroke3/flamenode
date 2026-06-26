import { normalizeHttpUrl } from "@/lib/utils/url";

export type SocialLink = {
  type: string;
  url: string;
};

export const SOCIAL_LINK_TYPE_OPTIONS = [
  "X",
  "Instagram",
  "TikTok",
  "Bluesky",
  "Niconico",
  "Website",
  "Other",
] as const;

const MAX_SOCIAL_LINKS = 8;
const MAX_SOCIAL_TYPE_LENGTH = 40;
const MAX_SOCIAL_URL_LENGTH = 500;

function cleanType(value: unknown): string {
  const text = String(value ?? "").trim().slice(0, MAX_SOCIAL_TYPE_LENGTH);
  const key = text.toLowerCase();
  if (key === "twitter" || key === "x") return "X";
  if (key === "instagram" || key === "insta") return "Instagram";
  if (key === "tiktok") return "TikTok";
  if (key === "bluesky" || key === "bsky") return "Bluesky";
  if (key === "niconico" || key === "nico" || key === "ニコニコ") return "Niconico";
  if (key === "web" || key === "website" || key === "site") return "Website";
  return text || "Other";
}

function normalizeSocialUrl(value: unknown): string | null {
  return normalizeHttpUrl(String(value ?? "").trim(), {
    maxLength: MAX_SOCIAL_URL_LENGTH,
  });
}

function normalizeSocialLinks(entries: unknown[]): SocialLink[] | null {
  const out: SocialLink[] = [];
  for (const entry of entries) {
    if (out.length >= MAX_SOCIAL_LINKS) break;
    if (!entry || typeof entry !== "object") continue;
    const row = entry as { type?: unknown; url?: unknown };
    const rawUrl = String(row.url ?? "").trim();
    if (!rawUrl) continue;
    const url = normalizeSocialUrl(rawUrl);
    if (!url) return null;
    out.push({ type: cleanType(row.type), url });
  }
  return out;
}

function parseLegacySocialLinks(raw: string): SocialLink[] {
  const chunks = raw
    .split(/[\n,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const out: SocialLink[] = [];
  for (const chunk of chunks) {
    if (out.length >= MAX_SOCIAL_LINKS) break;
    const pair = chunk.match(/^([^=:：]+)[=:：]\s*(https?:\/\/\S+)$/i);
    const looseUrl = chunk.match(/https?:\/\/\S+/i);
    const type = pair?.[1] ?? "Other";
    const url = normalizeSocialUrl(pair?.[2] ?? looseUrl?.[0] ?? "");
    if (url) out.push({ type: cleanType(type), url });
  }
  return out;
}

export function parseSocialLinks(raw: string | null | undefined): SocialLink[] {
  const text = raw?.trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      return normalizeSocialLinks(parsed) ?? [];
    }
  } catch {
    // Legacy free-text fallback.
  }
  return parseLegacySocialLinks(text);
}

export function serializeSocialLinks(entries: readonly SocialLink[]): string | null {
  const normalized = normalizeSocialLinks([...entries]);
  if (!normalized || normalized.length === 0) return null;
  return JSON.stringify(normalized);
}

export function validateSocialLinksJson(raw: string): {
  ok: boolean;
  value: string | null;
  message?: string;
} {
  const text = raw.trim();
  if (!text) return { ok: true, value: null };
  if (text.length > 5000) {
    return { ok: false, value: null, message: "SNSリンクが長すぎます。" };
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) {
      return { ok: false, value: null, message: "SNSリンクは配列形式で保存してください。" };
    }
    const normalized = normalizeSocialLinks(parsed);
    if (!normalized) {
      return {
        ok: false,
        value: null,
        message: "SNSリンクには http/https の有効なURLを入力してください。",
      };
    }
    return {
      ok: true,
      value: normalized.length > 0 ? JSON.stringify(normalized) : null,
    };
  } catch {
    return { ok: false, value: null, message: "SNSリンクのJSON形式が不正です。" };
  }
}

export function normalizeSocialLinksForStorage(
  raw: string | null | undefined,
): string | null {
  return serializeSocialLinks(parseSocialLinks(raw));
}

export function formatSocialLinksForText(raw: string | null | undefined): string {
  return parseSocialLinks(raw)
    .map((link) => `${link.type}=${link.url}`)
    .join("\n");
}
