import { Hono } from "hono";
import type { SettingsResponse, SettingsXId, XIdentityRequestRow } from "@flamenode/contracts";
import type { AppEnv } from "../../env.ts";
import { loadPersonalContext, parseJsonColumn, type LinkedXRow } from "./context.ts";
import { buildChannelCandidates, buildIconCandidates, candidatesStatement } from "./candidates.ts";

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

interface SettingsLinkedRow extends LinkedXRow {
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

export const personalSettingsRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const sessionUser = c.get("user");
  if (!sessionUser) return c.json({ error: "Unauthorized" }, 401);
  const db = c.env.DB;

  const isOnboarding = c.req.query("onboarding") === "1";
  const rawTab = c.req.query("tab");
  const legacyTab = rawTab === "account" || rawTab === "xids" ? rawTab : null;
  const utilityTab = legacyTab ? null : parseUtilityTab(rawTab);
  const requestedX = c.req.query("x")?.trim() || null;

  const ctx = await loadPersonalContext<SettingsLinkedRow>(db, sessionUser, {
    profileColumns: true,
    requestHistory: true,
  });
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
    const row = await candidatesStatement(db, activeXPanel.id).first<{
      icon_x: string | null;
      icon_videos: string | null;
      channel_x: string | null;
      channel_videos: string | null;
    }>();
    iconCandidates = buildIconCandidates(
      { icon_url: row?.icon_x ?? null },
      parseJsonColumn<Array<string | null>>(row?.icon_videos, []).map((icon_url) => ({ icon_url })),
    );
    channelCandidates = buildChannelCandidates(
      { youtube_channel_url: row?.channel_x ?? null },
      parseJsonColumn<Array<string | null>>(row?.channel_videos, []).map((youtube_channel_url) => ({
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
