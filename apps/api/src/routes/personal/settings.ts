import { Hono } from "hono";
import type { SettingsResponse, SettingsXId, XIdentityRequestRow } from "@flamenode/contracts";
import type { AppEnv } from "../../env.ts";
import { loadPersonalContext, parseJsonColumn } from "./context.ts";
import { buildChannelCandidates, buildIconCandidates, settingsRowsStatement } from "./candidates.ts";

// CURRENT: app/(auth)/dashboard/settings/page.tsx.
// D1 (S2, <= 3 statements incl. the session lookup): context = 1 statement (terms + linked X profile rows + 50 request
// history as JSON columns), then 1 candidates statement only when the X tab is shown (as CURRENT).

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

interface SettingsRow {
  kind: "x" | "cand";
  c1: unknown;
  c2: unknown;
  c3: unknown;
  c4: unknown;
  c5: unknown;
  c6: unknown;
  c7: unknown;
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

  // Statement 2: terms + header linked X (JSON, short columns) + request history (<= 50 small rows).
  const ctx = await loadPersonalContext(db, sessionUser, { requestHistory: true });
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);
  const { user, linkedRows: linked } = ctx;
  const requestHistory = ctx.history as XIdentityRequestRow[];

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
    requested_at: null,
    profile_text: null,
    portfolio_contact: null,
    youtube_channel_url: null,
    other_social_links: null,
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

  // Statement 3: profile text as ROWS (never packed into a JSON column) + the panel's candidate lists.
  const { results: rows } = await settingsRowsStatement(
    db,
    sessionUser.id,
    xTabSelected && activeXPanel ? activeXPanel.id : null,
  ).all<SettingsRow>();
  const byId = new Map(xIds.map((x) => [x.id, x]));
  let candidateRow: SettingsRow | undefined;
  for (const row of rows) {
    if (row.kind === "cand") {
      candidateRow = row;
      continue;
    }
    const x = byId.get(String(row.c1));
    if (!x) continue;
    x.requested_at = (row.c7 as number | null) ?? (row.c6 as number | null);
    x.profile_text = (row.c2 as string | null) ?? null;
    x.portfolio_contact = normalizePortfolioContact(row.c3 as string | null);
    x.other_social_links = (row.c4 as string | null) ?? null;
    x.youtube_channel_url = (row.c5 as string | null) ?? null;
  }

  let iconCandidates: string[] = [];
  let channelCandidates: string[] = [];
  if (candidateRow) {
    iconCandidates = buildIconCandidates(
      { icon_url: (candidateRow.c1 as string | null) ?? null },
      parseJsonColumn<Array<string | null>>(candidateRow.c2, []).map((icon_url) => ({ icon_url })),
    );
    channelCandidates = buildChannelCandidates(
      { youtube_channel_url: (candidateRow.c3 as string | null) ?? null },
      parseJsonColumn<Array<string | null>>(candidateRow.c4, []).map((youtube_channel_url) => ({
        youtube_channel_url,
      })),
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
