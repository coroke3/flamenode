// CURRENT: src/lib/db/xIconResolution.ts#getXIconCandidates, src/lib/db/youtubeChannelCandidates.ts,
// src/lib/utils/youtubeChannel.ts + src/lib/utils/url.ts (normalizers copied; domain-package candidate).

export const MAX_ICON_CANDIDATES = 12;
export const MAX_CHANNEL_CANDIDATES = 24;

function normalizeHttpUrl(raw: string | null | undefined, maxLength = 500): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (s.length > maxLength) return null;
  try {
    const url = new URL(s);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeYoutubeChannelUrl(raw: string | null | undefined): string | null {
  const http = normalizeHttpUrl(raw, 500);
  if (!http) return null;
  try {
    const url = new URL(http);
    const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");
    if (host !== "youtube.com") return null;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length === 0) return null;
    const head = segments[0]!;
    if (head.startsWith("@")) return `https://www.youtube.com/${head}`;
    if (head === "channel" || head === "c" || head === "user") {
      const id = segments[1];
      if (!id) return null;
      return `https://www.youtube.com/${head}/${id}`;
    }
    return null;
  } catch {
    return null;
  }
}

export function normalizeYoutubeChannelInput(raw: string | null | undefined): string | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  return normalizeYoutubeChannelUrl(trimmed) ?? normalizeHttpUrl(trimmed, 500);
}

/** x_users.icon_url first, then public video snapshots (newest first), de-duplicated, capped. */
export function iconCandidatesStatements(db: D1Database, xId: string): D1PreparedStatement[] {
  return [
    db.prepare("SELECT icon_url FROM x_users WHERE id = ? LIMIT 1").bind(xId),
    db
      .prepare(
        `SELECT creator_icon_url AS icon_url FROM videos
         WHERE creator_x_user_id = ? AND creator_icon_url IS NOT NULL AND visibility_status = 'public'
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .bind(xId, MAX_ICON_CANDIDATES * 2),
  ];
}

export function buildIconCandidates(
  xRow: { icon_url: string | null } | undefined,
  videoRows: ReadonlyArray<{ icon_url: string | null }>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  if (xRow?.icon_url) {
    out.push(xRow.icon_url);
    seen.add(xRow.icon_url);
    if (out.length >= MAX_ICON_CANDIDATES) return out;
  }
  for (const row of videoRows) {
    if (row.icon_url && !seen.has(row.icon_url)) {
      out.push(row.icon_url);
      seen.add(row.icon_url);
      if (out.length >= MAX_ICON_CANDIDATES) return out;
    }
  }
  return out;
}

/** x_users.youtube_channel_url first, then video snapshots (case-insensitive creator match, newest first). */
export function channelCandidatesStatements(db: D1Database, xId: string): D1PreparedStatement[] {
  const lower = xId.trim().toLowerCase();
  return [
    db.prepare("SELECT youtube_channel_url FROM x_users WHERE lower(id) = ? LIMIT 1").bind(lower),
    db
      .prepare(
        `SELECT creator_youtube_channel_url AS youtube_channel_url FROM videos
         WHERE lower(creator_x_user_id) = ? AND creator_youtube_channel_url IS NOT NULL
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .bind(lower, MAX_CHANNEL_CANDIDATES * 2),
  ];
}

export function buildChannelCandidates(
  xRow: { youtube_channel_url: string | null } | undefined,
  videoRows: ReadonlyArray<{ youtube_channel_url: string | null }>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | null | undefined) => {
    const normalized = normalizeYoutubeChannelInput(raw);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  };
  push(xRow?.youtube_channel_url);
  for (const row of videoRows) {
    push(row.youtube_channel_url);
    if (out.length >= MAX_CHANNEL_CANDIDATES) return out;
  }
  return out.slice(0, MAX_CHANNEL_CANDIDATES);
}
