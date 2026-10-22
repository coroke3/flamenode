import { Hono } from "hono";
import type { SettingsResponse, SettingsXId, XIdentityRequestRow } from "@flamenode/contracts";
import type { AppEnv } from "../../env.ts";
import {
  buildPersonalUser,
  termsStatement,
  type TermsRow,
} from "./context.ts";
import {
  buildChannelCandidates,
  buildIconCandidates,
  channelCandidatesStatements,
  iconCandidatesStatements,
} from "./candidates.ts";
import { MAX_LINKED_X_USERS } from "./sql.ts";

// CURRENT: app/(auth)/dashboard/settings/page.tsx.
// D1: 1 batch (terms + linked X profile rows + 50 request history), then 1 batch of 4 candidate
// statements only when the X tab is shown (CURRENT loads candidates for the shown panel only).
export const MAX_REQUEST_HISTORY = 50;

type UtilityTabId = "discord" | "link" | "history";

function parseUtilityTab(value: string | undefined): UtilityTabId | null {
  if (value === "pending") return "history";
  if (value === "discord" || value === "link" || value === "history") return value;
  return null;
}

function normalizePortfolioContact(value: string | null | undefined): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (text.toLowerCase() === "portfolio_contact") return null;
  return text;
}

/** CURRENT sortXIds. */
export function sortXIds(xIds: readonly SettingsXId[], activeXUserId: string | null): SettingsXId[] {
  const order = (status: SettingsXId["approval_status"]) =>
    status === "approved" ? 0 : status === "pending" ? 1 : 2;
  return [...xIds].sort((a, b) => {
    if (a.id === activeXUserId) return -1;
    if (b.id === activeXUserId) return 1;
    return order(a.approval_status) - order(b.approval_status);
  });
}

interface SettingsLinkedRow {
  x_user_id: string;
  x_name: string;
  icon_url: string | null;
  youtube_channel_url: string | null;
  profile_text: string | null;
  portfolio_contact: string | null;
  other_social_links: string | null;
  approval_status: string | null;
  created_at: number;
  request_requested_at: number | null;
}

/** CURRENT getLinkedXUsersForAuthUser (profile columns + the creating request's requested_at). */
function settingsLinkedStatement(db: D1Database, userId: string): D1PreparedStatement {
  return db
    .prepare(
      `SELECT x_users.id AS x_user_id, x_users.x_name AS x_name, x_users.icon_url AS icon_url,
         x_users.youtube_channel_url AS youtube_channel_url, x_users.profile_text AS profile_text,
         x_users.portfolio_contact AS portfolio_contact, x_users.other_social_links AS other_social_links,
         x_users.approval_status AS approval_status,
         x_user_account_links.created_at AS created_at,
         x_identity_requests.requested_at AS request_requested_at
       FROM x_user_account_links
       INNER JOIN x_users ON x_users.id = x_user_account_links.x_user_id
       LEFT JOIN x_identity_requests ON x_identity_requests.id = x_user_account_links.created_by_request_id
       WHERE x_user_account_links.auth_user_id = ?
       LIMIT ?`,
    )
    .bind(userId, MAX_LINKED_X_USERS);
}

export const personalSettingsRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const sessionUser = c.get("user");
  if (!sessionUser) return c.json({ error: "Unauthorized" }, 401);
  const db = c.env.DB;

  const isOnboarding = c.req.query("onboarding") === "1";
  const rawTab = c.req.query("tab");
  const legacyTab = rawTab === "account" || rawTab === "xids" ? rawTab : null;
  const utilityTab = legacyTab ? null : parseUtilityTab(rawTab);
  const requestedX = c.req.query("x")?.trim() || null;

  const [termsResult, linkedResult, historyResult] = await db.batch([
    termsStatement(db, sessionUser.id),
    settingsLinkedStatement(db, sessionUser.id),
    db
      .prepare(
        `SELECT id, request_type, requested_x_id, source_x_user_id, target_x_user_id, parent_request_id,
           revert_deadline_at, status, requested_at, updated_at
         FROM x_identity_requests
         WHERE requested_by_auth_user_id = ?
         ORDER BY requested_at DESC, id DESC
         LIMIT ?`,
      )
      .bind(sessionUser.id, MAX_REQUEST_HISTORY),
  ]);
  const terms = (termsResult?.results as TermsRow[] | undefined)?.[0];
  if (!terms) return c.json({ error: "Unauthorized" }, 401);
  const linked = (linkedResult?.results ?? []) as unknown as SettingsLinkedRow[];
  const requestHistory = (historyResult?.results ?? []) as unknown as XIdentityRequestRow[];
  const user = buildPersonalUser(sessionUser, terms, linked);

  const xIds: SettingsXId[] = linked.map((x) => ({
    id: x.x_user_id,
    x_name: x.x_name,
    icon_url: x.icon_url ?? null,
    approval_status:
      x.approval_status === "approved" ||
      x.approval_status === "pending" ||
      x.approval_status === "rejected" ||
      x.approval_status === "imported"
        ? x.approval_status
        : "pending",
    requested_at: x.request_requested_at ?? x.created_at,
    profile_text: x.profile_text ?? null,
    portfolio_contact: normalizePortfolioContact(x.portfolio_contact),
    youtube_channel_url: x.youtube_channel_url ?? null,
    other_social_links: x.other_social_links ?? null,
  }));

  const sortedXIds = sortXIds(xIds, user.active_x_user_id);
  const selectedX =
    utilityTab == null && requestedX
      ? xIds.find((x) => x.id.toLowerCase() === requestedX.toLowerCase()) ?? null
      : null;
  const defaultX =
    (user.active_x_user_id ? xIds.find((x) => x.id === user.active_x_user_id) : null) ??
    sortedXIds[0] ??
    null;
  const activeXPanel = selectedX ?? defaultX;
  const showUtilityTab = isOnboarding
    ? "link"
    : utilityTab ??
      (xIds.length === 0 && requestHistory.length === 0
        ? "link"
        : xIds.length === 0 && requestHistory.length > 0
          ? "history"
          : null);
  const xTabSelected = showUtilityTab == null && activeXPanel != null;

  let iconCandidates: string[] = [];
  let channelCandidates: string[] = [];
  if (xTabSelected && activeXPanel) {
    const [iconX, iconVideos, channelX, channelVideos] = await db.batch([
      ...iconCandidatesStatements(db, activeXPanel.id),
      ...channelCandidatesStatements(db, activeXPanel.id),
    ]);
    iconCandidates = buildIconCandidates(
      (iconX?.results as Array<{ icon_url: string | null }> | undefined)?.[0],
      (iconVideos?.results ?? []) as Array<{ icon_url: string | null }>,
    );
    channelCandidates = buildChannelCandidates(
      (channelX?.results as Array<{ youtube_channel_url: string | null }> | undefined)?.[0],
      (channelVideos?.results ?? []) as Array<{ youtube_channel_url: string | null }>,
    );
  }

  const body: SettingsResponse = {
    user,
    xIds,
    requestHistory: requestHistory.map((row) => ({
      id: row.id,
      request_type: row.request_type,
      requested_x_id: row.requested_x_id ?? null,
      source_x_user_id: row.source_x_user_id ?? null,
      target_x_user_id: row.target_x_user_id ?? null,
      parent_request_id: row.parent_request_id ?? null,
      revert_deadline_at: row.revert_deadline_at ?? null,
      status: row.status,
      requested_at: row.requested_at,
      updated_at: row.updated_at,
    })),
    panel: {
      xId: xTabSelected && activeXPanel ? activeXPanel.id : null,
      iconCandidates,
      channelCandidates,
    },
  };
  return c.json(body);
});
