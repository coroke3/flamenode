import { MAX_LINKED_X_USERS } from "./sql.ts";

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

/**
 * ONE statement for both candidate lists (CURRENT getXIconCandidates + getYoutubeChannelCandidates):
 * x_users profile value first, then video snapshots newest first (icons: public videos only;
 * channels: case-insensitive creator match). Lists are bounded JSON columns.
 */
export function settingsRowsStatement(
  db: D1Database,
  userId: string,
  candidateXId: string | null,
): D1PreparedStatement {
  // Rows (not JSON): one 'x' row per linked X with its profile text, so long profiles can never overflow a
  // JSON column. Columns c1..c7 are positional: x rows = id, profile_text, portfolio_contact,
  // other_social_links, youtube_channel_url, link created_at, creating request requested_at.
  // The optional single 'cand' row carries the bounded candidate lists: c1 = icon_x, c2 = icon_videos (JSON),
  // c3 = channel_x, c4 = channel_videos (JSON).
  const params: unknown[] = [userId, MAX_LINKED_X_USERS];
  let candidates = "";
  if (candidateXId) {
    const lower = candidateXId.trim().toLowerCase();
    candidates = `UNION ALL SELECT 1, 'cand',
         (SELECT icon_url FROM x_users WHERE id = ? LIMIT 1),
         (SELECT json_group_array(q.icon_url) FROM (
            SELECT creator_icon_url AS icon_url FROM videos
            WHERE creator_x_user_id = ? AND creator_icon_url IS NOT NULL AND visibility_status = 'public'
            ORDER BY created_at DESC
            LIMIT ?) q),
         (SELECT youtube_channel_url FROM x_users WHERE lower(id) = ? LIMIT 1),
         (SELECT json_group_array(q.youtube_channel_url) FROM (
            SELECT creator_youtube_channel_url AS youtube_channel_url FROM videos
            WHERE lower(creator_x_user_id) = ? AND creator_youtube_channel_url IS NOT NULL
            ORDER BY created_at DESC
            LIMIT ?) q),
         NULL, NULL, NULL`;
    params.push(candidateXId, candidateXId, MAX_ICON_CANDIDATES * 2, lower, lower, MAX_CHANNEL_CANDIDATES * 2);
  }
  return db
    .prepare(
      `SELECT part, kind, c1, c2, c3, c4, c5, c6, c7 FROM (
         SELECT 0 AS part, 'x' AS kind, q.id AS c1, q.profile_text AS c2, q.portfolio_contact AS c3,
           q.other_social_links AS c4, q.youtube_channel_url AS c5, q.created_at AS c6, q.requested_at AS c7
         FROM (
           SELECT x_users.id AS id, x_users.profile_text AS profile_text, x_users.portfolio_contact AS portfolio_contact,
             x_users.other_social_links AS other_social_links, x_users.youtube_channel_url AS youtube_channel_url,
             x_user_account_links.created_at AS created_at, x_identity_requests.requested_at AS requested_at
           FROM x_user_account_links
           INNER JOIN x_users ON x_users.id = x_user_account_links.x_user_id
           LEFT JOIN x_identity_requests ON x_identity_requests.id = x_user_account_links.created_by_request_id
           WHERE x_user_account_links.auth_user_id = ?
           ORDER BY x_users.id
           LIMIT ?
         ) q
         ${candidates}
       )
       ORDER BY part, c1`,
    )
    .bind(...params);
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
