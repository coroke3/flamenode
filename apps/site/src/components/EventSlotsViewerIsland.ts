import * as React from "react";
import { ACTIVE_X_CHANGED_EVENT } from "../../../../src/lib/client/activeXSwitchEvents.ts";
import type {
  SlotViewerOverlayDto,
  SlotViewerOverlaySlot,
} from "../../../../src/lib/slots/slotViewerOverlayCore.ts";

/**
 * MIG-0514 U01: private viewer overlay for the public slot page.
 * Mount this inside EventSlotsIsland after MIG-0502 releases its file ownership.
 * SSR/JS-disabled HTML never contains viewer-specific data or write controls.
 */
export const SLOT_VIEWER_OVERLAY_TIMEOUT_MS = 5_000;

const EMPTY_OVERLAY: SlotViewerOverlayDto = {
  loggedIn: false,
  authUnavailable: false,
  isBanned: false,
  needsTermsAcceptance: false,
  canReserveSlot: false,
  canPost: false,
  operatorOverrideAllowed: false,
  viewerXId: null,
  viewerXIdNotice: null,
  slots: [],
};

export const unavailableSlotViewerOverlay = (): SlotViewerOverlayDto => ({
  ...EMPTY_OVERLAY,
  authUnavailable: true,
});

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseSlot(value: unknown): SlotViewerOverlaySlot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !row.id) return null;
  if (!["active", "unassigned", "account_other", "none"].includes(String(row.viewer_relation))) return null;
  if (typeof row.is_owned_by_viewer !== "boolean") return null;
  return {
    id: row.id,
    display_name: nullableString(row.display_name),
    reserved_x_id: nullableString(row.reserved_x_id),
    profile_x_user_id: nullableString(row.profile_x_user_id),
    submitted_icon_url: nullableString(row.submitted_icon_url),
    is_owned_by_viewer: row.is_owned_by_viewer,
    viewer_relation: row.viewer_relation as SlotViewerOverlaySlot["viewer_relation"],
    group_key: nullableString(row.group_key),
    x_user_id: nullableString(row.x_user_id),
  };
}

/** Exact CURRENT shape checks for privilege booleans; invalid payload fails closed. */
export function parseSlotViewerOverlay(value: unknown): SlotViewerOverlayDto | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const flags = ["loggedIn", "authUnavailable", "isBanned", "needsTermsAcceptance", "canReserveSlot", "canPost", "operatorOverrideAllowed"] as const;
  if (flags.some((flag) => typeof row[flag] !== "boolean") || !Array.isArray(row.slots)) return null;
  return {
    loggedIn: row.loggedIn as boolean,
    authUnavailable: row.authUnavailable as boolean,
    isBanned: row.isBanned as boolean,
    needsTermsAcceptance: row.needsTermsAcceptance as boolean,
    canReserveSlot: row.canReserveSlot as boolean,
    canPost: row.canPost as boolean,
    operatorOverrideAllowed: row.operatorOverrideAllowed as boolean,
    viewerXId: nullableString(row.viewerXId),
    viewerXIdNotice: nullableString(row.viewerXIdNotice),
    slots: row.slots.map(parseSlot).filter((slot): slot is SlotViewerOverlaySlot => slot !== null),
  };
}

/** RH-014: no-store, same-origin session, 5 s deadline; never propagate a stale privileged overlay. */
export async function fetchSlotViewerOverlay(
  eventId: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
  timeoutMs = SLOT_VIEWER_OVERLAY_TIMEOUT_MS,
): Promise<SlotViewerOverlayDto> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) return unavailableSlotViewerOverlay();
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, timeoutMs);
  try {
    const response = await fetcher(`/api/events/${encodeURIComponent(eventId)}/slots/viewer-overlay`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    // Some custom fetch implementations resolve after AbortSignal is fired.
    // Never grant stale viewer permissions after timeout or a cancelled refresh.
    if (controller.signal.aborted || !response.ok) return unavailableSlotViewerOverlay();
    const payload = await response.json();
    if (controller.signal.aborted) return unavailableSlotViewerOverlay();
    return parseSlotViewerOverlay(payload) ?? unavailableSlotViewerOverlay();
  } catch {
    return unavailableSlotViewerOverlay();
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

export interface ViewerSlotBase {
  id: string;
  display_name?: string | null;
  reserved_x_id?: string | null;
  profile_x_user_id?: string | null;
  submitted_icon_url?: string | null;
  group_key?: string | null;
}

export type ViewerSlot<T extends ViewerSlotBase> = T & {
  is_owned_by_viewer: boolean;
  viewer_relation: SlotViewerOverlaySlot["viewer_relation"];
  group_key: string | null;
  x_user_id: string | null;
};

/** Public-name groups remain the base authority; private groups are viewer-scoped opaque keys. */
export function mergeViewerSlotOverlay<T extends ViewerSlotBase>(
  baseSlots: readonly T[],
  overlay: SlotViewerOverlayDto,
  allowOwnOperations: boolean,
): ViewerSlot<T>[] {
  const byId = new Map(overlay.slots.map((slot) => [slot.id, slot] as const));
  return baseSlots.map((slot) => {
    const patch = byId.get(slot.id);
    return {
      ...slot,
      display_name: patch?.display_name ?? slot.display_name ?? null,
      reserved_x_id: patch?.reserved_x_id ?? slot.reserved_x_id ?? null,
      profile_x_user_id: patch?.profile_x_user_id ?? slot.profile_x_user_id ?? null,
      submitted_icon_url: patch?.submitted_icon_url ?? slot.submitted_icon_url ?? null,
      is_owned_by_viewer: allowOwnOperations && (patch?.is_owned_by_viewer ?? false),
      viewer_relation: patch?.viewer_relation ?? "none",
      group_key: slot.group_key ?? patch?.group_key ?? null,
      x_user_id: patch?.x_user_id ?? null,
    };
  });
}

export interface ViewerSlotsState<T extends ViewerSlotBase> {
  overlay: SlotViewerOverlayDto;
  loading: boolean;
  slots: ViewerSlot<T>[];
  canTakeSlot: boolean;
  canManageOwnSlots: boolean;
  refresh: () => void;
}

export function useEventSlotsViewer<T extends ViewerSlotBase>(
  eventId: string,
  baseSlots: readonly T[],
  accepting: boolean,
): ViewerSlotsState<T> {
  const [overlayState, setOverlayState] = React.useState<{
    value: SlotViewerOverlayDto;
    baseSlots: readonly T[] | null;
    eventId: string | null;
  }>({ value: EMPTY_OVERLAY, baseSlots: null, eventId: null });
  const [loading, setLoading] = React.useState(true);
  const [refreshNonce, setRefreshNonce] = React.useState(0);
  const generation = React.useRef(0);

  const refresh = React.useCallback(() => {
    // Invalidate in-flight responses synchronously, even before React's effect cleanup.
    generation.current += 1;
    setOverlayState({ value: EMPTY_OVERLAY, baseSlots: null, eventId: null });
    setLoading(true);
    setRefreshNonce((n) => n + 1);
  }, []);

  React.useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const capturedBase = baseSlots;
    const requestGeneration = ++generation.current;
    setLoading(true);
    void fetchSlotViewerOverlay(eventId, controller.signal).then((value) => {
      if (!active || generation.current !== requestGeneration) return;
      setOverlayState({ value, baseSlots: capturedBase, eventId });
      setLoading(false);
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [eventId, baseSlots, refreshNonce]);

  React.useEffect(() => {
    window.addEventListener(ACTIVE_X_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(ACTIVE_X_CHANGED_EVENT, refresh);
  }, [refresh]);

  // Do not associate an old viewer response with a newly refreshed public slot array.
  const current = overlayState.baseSlots === baseSlots && overlayState.eventId === eventId;
  const value = current ? overlayState.value : EMPTY_OVERLAY;
  const pending = loading || !current;
  const canManageOwnSlots = !pending && value.loggedIn &&
    !value.authUnavailable && !value.isBanned && !value.needsTermsAcceptance;
  const canTakeSlot = canManageOwnSlots && value.canReserveSlot &&
    (accepting || value.operatorOverrideAllowed);
  const slots = React.useMemo(
    () => mergeViewerSlotOverlay(baseSlots, value, canManageOwnSlots),
    [baseSlots, value, canManageOwnSlots],
  );
  return { overlay: value, loading: pending, slots, canTakeSlot, canManageOwnSlots, refresh };
}

/** Host-level React wrapper; later U03 supplies SlotGrid controls as a render function. */
export function EventSlotsViewerIsland<T extends ViewerSlotBase>({
  eventId,
  baseSlots,
  accepting,
  eventStatus,
  children,
}: {
  eventId: string;
  baseSlots: readonly T[];
  accepting: boolean;
  eventStatus: string;
  children: (viewer: ViewerSlotsState<T>) => React.ReactNode;
}): React.ReactElement {
  const state = useEventSlotsViewer(eventId, baseSlots, accepting);
  const currentPath = `/event/${encodeURIComponent(eventId)}/slots`;
  const link = (path: string, label: string) =>
    React.createElement("a", { href: `${path}?next=${encodeURIComponent(currentPath)}` }, label);
  const message = !accepting && !state.overlay.operatorOverrideAllowed
    ? eventStatus === "ended"
      ? "終了済みのため新規確保はできません。"
      : eventStatus === "scheduled"
        ? "受付開始までお待ちください。"
        : "現在は受付停止中です。"
    : state.loading
      ? "ログイン状態を確認しています。"
    : state.overlay.authUnavailable
      ? "ログイン状態を一時的に確認できません。時間をおいて再読み込みしてください。"
      : !state.overlay.loggedIn
        ? React.createElement(React.Fragment, null, "確保には", link("/entry", "ログイン"), "が必要です。")
        : state.overlay.isBanned
          ? "現在、このアカウントは利用停止中です。"
          : state.overlay.needsTermsAcceptance
            ? React.createElement(React.Fragment, null, "確保には", link("/rules", "利用規約への同意"), "が必要です。")
            : !accepting && state.overlay.operatorOverrideAllowed
              ? "イベント運営権限で、募集開始前の枠確保やイベント上限を超える予約ができます。実行時に警告を確認してください。"
              : null;
  return React.createElement(React.Fragment, null,
    message ? React.createElement("p", { role: "status", className: "notice" }, message) : null,
    state.overlay.viewerXIdNotice
      ? React.createElement("p", { role: "status", className: "notice" }, state.overlay.viewerXIdNotice)
      : null,
    children(state),
  );
}
