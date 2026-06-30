import { normalizeHttpUrl } from "#utils/url";

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
  "Portfolio",
  "Tumblr",
  "Discord",
  "Email",
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
  if (key === "portfolio") return "Portfolio";
  if (key === "tumblr" || key === "tumbler") return "Tumblr";
  if (key === "discord") return "Discord";
  if (key === "email" || key === "mail") return "Email";
  if (key === "web" || key === "website" || key === "site") return "Website";
  return text || "Other";
}

function normalizeSocialUrl(value: unknown, type?: string): string | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const typeKey = cleanType(type).toLowerCase();

  if (typeKey === "email") {
    const raw = trimmed.replace(/^mailto:/i, "").split("?")[0]?.trim() ?? "";
    if (!raw || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return null;
    return `mailto:${raw}`;
  }

  if (/^mailto:/i.test(trimmed)) return null;
  if (!trimmed.includes("://") && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;

  return normalizeHttpUrl(trimmed, {
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
    const url = normalizeSocialUrl(rawUrl, cleanType(row.type));
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
    const pair = chunk.match(/^([^=:：]+)[=:：]\s*(\S+)$/i);
    const looseUrl = chunk.match(/(?:https?:\/\/|mailto:)\S+/i);
    const looseEmail = chunk.match(/[^\s@]+@[^\s@]+\.[^\s@]+/i);
    const type = pair?.[1] ?? (/^mailto:/i.test(looseUrl?.[0] ?? "") || looseEmail ? "Email" : "Other");
    const url = normalizeSocialUrl(pair?.[2] ?? looseUrl?.[0] ?? looseEmail?.[0] ?? "", cleanType(type));
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
        message: "SNSリンクには、Email はメールアドレス、それ以外は http/https の有効なURLを入力してください。",
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

export function socialLinkIconName(type: string): "x" | "discord" | "mail" | "external" {
  switch (cleanType(type)) {
    case "X":
      return "x";
    case "Discord":
      return "discord";
    case "Email":
      return "mail";
    default:
      return "external";
  }
}

export function formatSocialLinkLabel(type: string, url: string): string {
  const normalizedType = cleanType(type);
  if (normalizedType === "Email") {
    return url.replace(/^mailto:/i, "").split("?")[0] ?? url;
  }
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    const path = parsed.pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => {
        try {
          return decodeURIComponent(segment);
        } catch {
          return segment;
        }
      })
      .join("/");
    if (!path) return host;
    return `${host}/${path}`;
  } catch {
    return url;
  }
}

/** プロフィールヘッダー用。プライマリ X ID と重複する X リンクは除外する。 */
export function profileHeaderSocialLinks(
  links: readonly SocialLink[],
  xUserId: string,
): SocialLink[] {
  const primaryXHandle = xUserId.trim().replace(/^@/, "").toLowerCase();
  if (!primaryXHandle) return [...links];
  return links.filter((link) => {
    if (cleanType(link.type) !== "X") return true;
    try {
      const parsed = new URL(link.url);
      const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
      if (host !== "x.com" && host !== "twitter.com") return true;
      const path = parsed.pathname.replace(/^\/+|\/+$/g, "").toLowerCase();
      return path !== primaryXHandle;
    } catch {
      return true;
    }
  });
}
