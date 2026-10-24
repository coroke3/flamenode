import type { EntryInitialProfile, EntrySubmitBlock, EntryXIdOption, PersonalUser } from "@flamenode/contracts";
import { buildChannelCandidates } from "../candidates.ts";
import type { LinkedXRow } from "../context.ts";
import { armOf, armOne, type ArmRows } from "./rows.ts";
import { MAX_ENTRY_ICON_CANDIDATES, MAX_SOFTWARE_SUGGESTIONS } from "./sql.ts";

// Builders for the data both post forms (slotted / unslotted) receive. CURRENT: getUsedSoftwareSuggestions
// (src/lib/db/videoFormSuggestions.ts), getXIconCandidates (xIconResolution.ts), getYoutubeChannelCandidates.

const val = (row: Record<string, unknown> | undefined): string | null => (row?.v as string | null | undefined) ?? null;

/** CURRENT getUsedSoftwareSuggestions: catalog names, then aliases up to the limit, de-duplicated. */
export function softwareSuggestionsOf(arms: ArmRows): string[] {
  const catalog = armOf(arms, "sw_cat").map((r) => val(r) as string);
  if (catalog.length >= MAX_SOFTWARE_SUGGESTIONS) return catalog;
  const aliases = armOf(arms, "sw_alias")
    .map((r) => val(r) as string)
    .slice(0, MAX_SOFTWARE_SUGGESTIONS - catalog.length);
  return Array.from(new Set([...catalog, ...aliases]));
}

/** CURRENT getXIconCandidates(db, activeX) (default limit 24): profile icon first, then public video icons newest first. */
export function iconCandidatesOf(arms: ArmRows): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const profile = val(armOne(arms, "icon_x") ?? undefined);
  if (profile) {
    out.push(profile);
    seen.add(profile);
    if (out.length >= MAX_ENTRY_ICON_CANDIDATES) return out;
  }
  for (const row of armOf(arms, "icon_v")) {
    const icon = val(row);
    if (icon && !seen.has(icon)) {
      out.push(icon);
      seen.add(icon);
      if (out.length >= MAX_ENTRY_ICON_CANDIDATES) return out;
    }
  }
  return out;
}

/** CURRENT getYoutubeChannelCandidates(db, activeX) (default limit 24 == MAX_CHANNEL_CANDIDATES). */
export function channelCandidatesOf(arms: ArmRows): string[] {
  return buildChannelCandidates(
    { youtube_channel_url: val(armOne(arms, "chan_x") ?? undefined) },
    armOf(arms, "chan_v").map((r) => ({ youtube_channel_url: val(r) })),
  );
}

export interface ActiveXRow {
  x_name: string;
  icon_url: string | null;
  approval_status: string | null;
  profile_text: string | null;
  youtube_channel_url: string | null;
  other_social_links: string | null;
}

/** CURRENT initialProfile (undefined -> null on the wire). */
export function initialProfileOf(displayName: string, xRow: ActiveXRow | null, user: PersonalUser): EntryInitialProfile {
  return {
    display_name: displayName,
    icon_url: xRow?.icon_url ?? user.image ?? null,
    profile_text: xRow?.profile_text ?? null,
    youtube_channel_url: xRow?.youtube_channel_url ?? null,
    other_social_links: xRow?.other_social_links ?? null,
  };
}

/** Approved linked X IDs as the form's options (CURRENT getLinkedXUsersForAuthUser approvedOnly / x_users join). */
export function approvedXRows(linkedRows: readonly LinkedXRow[]): EntryXIdOption[] {
  return linkedRows
    .filter((row) => row.approval_status === "approved")
    .map((row) => ({ id: row.x_user_id, x_name: row.x_name }));
}

/** CURRENT submitBlockedReason ladder for the unslotted page. */
export function unslottedSubmitBlock(
  activeX: string | null,
  options: readonly EntryXIdOption[],
  xRow: ActiveXRow | null,
): EntrySubmitBlock {
  if (!activeX) return "no_active_x";
  if (!options.some((option) => option.id === activeX)) return "not_linked";
  if (xRow?.approval_status !== "approved") return "not_approved";
  return null;
}

/** CURRENT submitBlockedReason ladder for the slotted page (`activeXId` is the user's, not the slot's). */
export function slottedSubmitBlock(activeXId: string | null, xRow: ActiveXRow | null): EntrySubmitBlock {
  if (!activeXId) return "no_active_x";
  const status = xRow?.approval_status ?? null;
  if (status === "pending") return "pending";
  if (status === "rejected") return "rejected";
  if (status !== "approved") return "not_approved";
  return null;
}
