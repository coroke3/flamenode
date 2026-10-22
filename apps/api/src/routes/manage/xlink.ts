import { Hono } from "hono";
import type { ManageXLinkRequest, ManageXLinkRequestsResponse } from "@flamenode/contracts";
import { normalizeXId } from "@flamenode/domain/xid";
import type { AppEnv } from "../../env.ts";
import { parseJsonColumn } from "../personal/context.ts";
import { loadManageSnapshot, manageGate } from "./access.ts";
import { resolveManageXIconUrl } from "./icon.ts";

// CURRENT: app/(manage)/manage/x-link-requests/page.tsx + src/lib/admin/enrichXLinkPendingRows.ts.
// Authorization (CURRENT): canManageXIdLinkRequests (admin, or a staff row that holds xid.link_requests), else notFound -> 404.
// D1 (S2, 3 statements incl. the session lookup): staff snapshot (admins skip it), then ONE statement that does what
// CURRENT does in 3 + 2 chunked queries: pending rows (100), X user lookup (primary key first, then the legacy
// lower(trim(id)) match only when the key misses) and the creator-icon fallback from past videos.
// Known gap: the SQL id normalisation trims ASCII whitespace and leading "@" and lowercases (CURRENT normalizeXId also
// trims Unicode whitespace); the returned ids are normalised in JS exactly like CURRENT.
const PENDING_LIMIT = 100;

const norm = (column: string): string =>
  `lower(ltrim(trim(${column}, ' ' || char(9) || char(10) || char(13)), '@'))`;

const xUserLookup = (n: string): string =>
  `COALESCE(
      (SELECT json_object('n', x_name, 'i', icon_url, 'a', approval_status) FROM x_users WHERE id = ${n} LIMIT 1),
      (SELECT json_object('n', x_name, 'i', icon_url, 'a', approval_status) FROM x_users WHERE lower(trim(id)) = ${n} ORDER BY id LIMIT 1))`;

const videoIcon = (n: string, xuser: string): string =>
  `CASE WHEN ${n} IS NOT NULL AND ${n} <> '' AND json_extract(${xuser}, '$.i') IS NULL THEN COALESCE(
      (SELECT creator_icon_url FROM videos WHERE creator_x_user_id = ${n} AND creator_icon_url IS NOT NULL AND creator_icon_url <> ''
        ORDER BY created_at DESC LIMIT 1),
      (SELECT creator_icon_url FROM videos WHERE lower(trim(creator_x_user_id)) = ${n} AND creator_icon_url IS NOT NULL AND creator_icon_url <> ''
        ORDER BY created_at DESC LIMIT 1)) END`;

interface RawRow {
  id: string;
  requested_x_id: string | null;
  requested_by_auth_user_id: string;
  discord_name: string | null;
  discord_image: string | null;
  requested_at: number;
  request_type: string;
  target_x_user_id: string | null;
  rx: { n: string | null; i: string | null; a: string | null } | null;
  tx: { n: string | null; i: string | null; a: string | null } | null;
  rv: string | null;
  tv: string | null;
}

export const manageXLinkRequestRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const db = c.env.DB;
  const snapshot = await loadManageSnapshot(db, user);
  const denied = manageGate(c, snapshot);
  if (denied) return denied;
  if (!snapshot.canManageXIdLinkRequests) return c.json({ error: "Not Found" }, 404);

  const row = await db
    .prepare(
      `SELECT json_group_array(json_object(
          'id', o.id, 'requested_x_id', o.requested_x_id, 'requested_by_auth_user_id', o.requested_by_auth_user_id,
          'discord_name', o.discord_name, 'discord_image', o.discord_image, 'requested_at', o.requested_at,
          'request_type', o.request_type, 'target_x_user_id', o.target_x_user_id,
          'rx', json(o.rx), 'tx', json(o.tx), 'rv', ${videoIcon("o.rn", "o.rx")}, 'tv', ${videoIcon("o.tn", "o.tx")})) AS rows
       FROM (
         SELECT p.*, ${xUserLookup("p.rn")} AS rx, ${xUserLookup("p.tn")} AS tx FROM (
           SELECT r.id AS id, r.requested_x_id AS requested_x_id, r.requested_by_auth_user_id AS requested_by_auth_user_id,
             u.name AS discord_name, u.image AS discord_image, r.requested_at AS requested_at,
             r.request_type AS request_type, r.target_x_user_id AS target_x_user_id,
             ${norm("r.requested_x_id")} AS rn, ${norm("r.target_x_user_id")} AS tn
           FROM x_identity_requests r
           LEFT JOIN "user" u ON u.id = r.requested_by_auth_user_id
           WHERE r.status = 'pending' AND r.request_type IN ('new_link', 'existing_link')
           ORDER BY r.requested_at DESC, r.id DESC
           LIMIT ?) p
       ) o`,
    )
    .bind(PENDING_LIMIT)
    .first<{ rows: string | null }>();

  const raw = parseJsonColumn<RawRow[]>(row?.rows, []);
  const rows: ManageXLinkRequest[] = await Promise.all(
    raw.map(async (r) => {
      const requestedXId = normalizeXId(r.requested_x_id);
      const targetXId = normalizeXId(r.target_x_user_id);
      // CURRENT resolveIcon: x_users.icon_url ?? video fallback (an empty string icon stays empty)
      const requestedIcon = requestedXId ? (r.rx?.i ?? r.rv ?? null) : null;
      const targetIcon = targetXId ? (r.tx?.i ?? r.tv ?? null) : null;
      return {
        id: r.id,
        requested_x_id: requestedXId || "",
        requested_by_auth_user_id: r.requested_by_auth_user_id,
        discord_name: r.discord_name,
        discord_image: r.discord_image,
        requested_at: r.requested_at,
        request_type: r.request_type,
        target_x_user_id: r.target_x_user_id,
        requested_x_name: r.rx?.n ?? null,
        requested_icon_url: await resolveManageXIconUrl({
          iconUrl: requestedIcon,
          approvalStatus: requestedXId ? (r.rx?.a ?? null) : null,
          authSecret: c.env.AUTH_SECRET,
        }),
        requested_approval_status: requestedXId ? (r.rx?.a ?? null) : null,
        target_icon_url: await resolveManageXIconUrl({
          iconUrl: targetIcon,
          approvalStatus: targetXId ? (r.tx?.a ?? null) : null,
          authSecret: c.env.AUTH_SECRET,
        }),
        target_approval_status: targetXId ? (r.tx?.a ?? null) : null,
      };
    }),
  );
  const body: ManageXLinkRequestsResponse = { rows };
  return c.json(body);
});
