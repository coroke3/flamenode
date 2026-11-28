import * as React from "react";
import { ACTIVE_X_CHANGED_EVENT } from "../../../../src/lib/client/activeXSwitchEvents.ts";
import {
  runSlotMutation,
  type SlotMutationOutcome,
  type SlotMutationPresentation,
} from "../lib/slotReservation.ts";
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
  const relation = row.viewer_relation;
  if (relation !== "active" && relation !== "unassigned" &&
      relation !== "account_other" && relation !== "none") return null;
  if (typeof row.is_owned_by_viewer !== "boolean") return null;
  // CURRENT derives this flag from canActAsSlotActor(viewer_relation).
  // Reject contradictions in BOTH directions. Otherwise an apparently denied
  // row with an "active" relation could still inject private identity fields
  // into the merged public slot, despite its owned flag being false.
  const relationAllowsOwnership =
    relation === "active" || relation === "unassigned";
  if (row.is_owned_by_viewer !== relationAllowsOwnership) return null;
  return {
    id: row.id,
    display_name: nullableString(row.display_name),
    reserved_x_id: nullableString(row.reserved_x_id),
    profile_x_user_id: nullableString(row.profile_x_user_id),
    submitted_icon_url: nullableString(row.submitted_icon_url),
    is_owned_by_viewer: row.is_owned_by_viewer,
    viewer_relation: relation,
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
  // Count IDs from raw rows *before* normalization. Otherwise an invalid
  // duplicate (e.g. owned=true / relation=none) is discarded and a different
  // row for the same ID is incorrectly treated as unambiguous.
  const parsedSlots: SlotViewerOverlaySlot[] = [];
  const seenIds = new Set<string>();
  const ambiguousIds = new Set<string>();
  for (const rawSlot of row.slots) {
    if (rawSlot && typeof rawSlot === "object" && !Array.isArray(rawSlot)) {
      const id = (rawSlot as Record<string, unknown>).id;
      if (typeof id === "string" && id.length > 0) {
        if (seenIds.has(id)) ambiguousIds.add(id);
        seenIds.add(id);
      }
    }
    const slot = parseSlot(rawSlot);
    if (slot) parsedSlots.push(slot);
  }
  // RH-020 public rows remain authoritative for every ambiguous private ID.
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
    slots: parsedSlots.filter((slot) => !ambiguousIds.has(slot.id)),
  };
}

/** RH-014: no-store, same-origin session, 5 s deadline; never propagate a stale privileged overlay. */
export async function fetchSlotViewerOverlay(
  eventId: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
  timeoutMs = SLOT_VIEWER_OVERLAY_TIMEOUT_MS,
): Promise<SlotViewerOverlayDto> {
  if (signal?.aborted) return unavailableSlotViewerOverlay();
  const controller = new AbortController();
  // AbortSignal is advisory: a custom fetch or response.json() may never
  // settle after abort. Resolve the caller independently of network promises.
  let finishAbort: (() => void) | undefined;
  const interrupted = new Promise<null>((resolve) => {
    finishAbort = () => resolve(null);
  });
  const abort = () => {
    controller.abort();
    finishAbort?.();
  };
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, timeoutMs);
  try {
    const result = await Promise.race([
      (async (): Promise<SlotViewerOverlayDto> => {
        const response = await fetcher(`/api/events/${encodeURIComponent(eventId)}/slots/viewer-overlay`, {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        // A late fetch/JSON result must never restore expired permissions.
        if (controller.signal.aborted || !response.ok) return unavailableSlotViewerOverlay();
        const payload = await response.json();
        if (controller.signal.aborted) return unavailableSlotViewerOverlay();
        return parseSlotViewerOverlay(payload) ?? unavailableSlotViewerOverlay();
      })(),
      interrupted,
    ]);
    return result ?? unavailableSlotViewerOverlay();
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
    // Denied/banned/terms-unaccepted viewers may still receive a contradictory
    // private patch from a stale or malformed overlay response. Never copy its
    // name, X identifiers, opaque group or profile fields into renderable rows.
    // The independently fetched public base is the only allowed fallback.
    const patch = allowOwnOperations ? byId.get(slot.id) : undefined;
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
  /** Capture only from the currently committed authorized viewer snapshot. */
  captureMutationReceipt: () => (() => boolean) | null;
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
    scope: object | null;
  }>({ value: EMPTY_OVERLAY, baseSlots: null, eventId: null, scope: null });
  const [loading, setLoading] = React.useState(true);
  const [refreshNonce, setRefreshNonce] = React.useState(0);
  // A distinct request receipt is required even if A→B→A reuses the same
  // event ID and public array. Raw overlay fields must not revive while pending.
  const overlayScope = React.useMemo(
    () => ({ eventId, baseSlots, refreshNonce }),
    [eventId, baseSlots, refreshNonce],
  );
  const generation = React.useRef(0);
  const committedMutationScope = React.useRef<{ scope: object } | null>(null);

  const refresh = React.useCallback(() => {
    // Invalidate in-flight responses synchronously, even before React's effect cleanup.
    generation.current += 1;
    committedMutationScope.current = null;
    setOverlayState({ value: EMPTY_OVERLAY, baseSlots: null, eventId: null, scope: null });
    setLoading(true);
    setRefreshNonce((n) => n + 1);
  }, []);

  React.useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const capturedBase = baseSlots;
    const requestScope = overlayScope;
    const requestGeneration = ++generation.current;
    setLoading(true);
    void fetchSlotViewerOverlay(eventId, controller.signal).then((value) => {
      if (!active || generation.current !== requestGeneration) return;
      setOverlayState({ value, baseSlots: capturedBase, eventId, scope: requestScope });
      setLoading(false);
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [eventId, baseSlots, refreshNonce, overlayScope]);

  React.useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) refresh();
    };
    window.addEventListener(ACTIVE_X_CHANGED_EVENT, refresh);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener(ACTIVE_X_CHANGED_EVENT, refresh);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [refresh]);

  // Bind the receipt to the distinct request as well as event and public data.
  const current = overlayState.scope === overlayScope &&
    overlayState.baseSlots === baseSlots && overlayState.eventId === eventId;
  const pending = loading || !current;
  const value = pending ? EMPTY_OVERLAY : overlayState.value;
  const canManageOwnSlots = !pending && value.loggedIn &&
    !value.authUnavailable && !value.isBanned && !value.needsTermsAcceptance;
  const canTakeSlot = canManageOwnSlots && value.canReserveSlot &&
    (accepting || value.operatorOverrideAllowed);
  const slots = React.useMemo(
    () => mergeViewerSlotOverlay(baseSlots, value, canManageOwnSlots),
    [baseSlots, value, canManageOwnSlots],
  );
  // U03h: receipt fencing for the future unmounted mutation host. A new
  // committed RH-014/RH-020 snapshot, event or permission state supersedes the
  // previous snapshot, even if the same Active X ID appears again.
  const mutationScope = React.useMemo(
    () => canManageOwnSlots ? { eventId, baseSlots, overlay: value, canTakeSlot } : null,
    [canManageOwnSlots, eventId, baseSlots, value, canTakeSlot],
  );
  React.useLayoutEffect(() => {
    const committed = mutationScope ? { scope: mutationScope } : null;
    committedMutationScope.current = committed;
    return () => {
      if (committedMutationScope.current === committed) committedMutationScope.current = null;
    };
  }, [mutationScope]);
  const captureMutationReceipt = React.useCallback(() => {
    const committed = committedMutationScope.current;
    if (!mutationScope || committed?.scope !== mutationScope) return null;
    return () => committedMutationScope.current === committed;
  }, [mutationScope]);
  // This is a UI receipt, not server authorization or a mutation lock.
  // The host must validate it again before displaying/redirecting a result.
  return { overlay: value, loading: pending, slots, canTakeSlot, canManageOwnSlots, refresh, captureMutationReceipt };
}


export type SlotMutationAction = Parameters<typeof runSlotMutation>[1];
export type SlotMutationOutcomeHandler = (
  outcome: SlotMutationOutcome,
  isCurrent: () => boolean,
) => void;
export type SlotMutationHostResult =
  | { kind: "busy" }
  | { kind: "stale" }
  | { kind: "settled"; outcome: SlotMutationOutcome; isCurrent: () => boolean };

export interface ViewerSlotsHostState<T extends ViewerSlotBase> extends ViewerSlotsState<T> {
  runMutation: (
    presentation: SlotMutationPresentation,
    mutate: SlotMutationAction,
    onOutcome?: SlotMutationOutcomeHandler,
  ) => Promise<SlotMutationHostResult>;
}

const NO_PUBLIC_REFRESH = () => Promise.resolve(false);

/** Host-level wrapper; U03k exposes a receipt-scoped single-flight mutation host. */
export function EventSlotsViewerIsland<T extends ViewerSlotBase>({
  eventId,
  baseSlots,
  accepting,
  eventStatus,
  refreshPublic,
  onNavigate,
  children,
}: {
  eventId: string;
  baseSlots: readonly T[];
  accepting: boolean;
  eventStatus: string;
  refreshPublic?: () => Promise<boolean>;
  onNavigate?: (path: string) => void;
  children: (viewer: ViewerSlotsHostState<T>) => React.ReactNode;
}): React.ReactElement {
  const state = useEventSlotsViewer(eventId, baseSlots, accepting);
  const currentPath = `/event/${encodeURIComponent(eventId)}/slots`;
  const refreshPublicRead = refreshPublic ?? NO_PUBLIC_REFRESH;
  const defaultNavigate = React.useCallback((path: string) => {
    if (typeof window !== "undefined") window.location.assign(path);
  }, []);
  const navigate = onNavigate ?? defaultNavigate;
  const inFlight = React.useRef(false);
  const staleReconcilePending = React.useRef(false);
  const reconcileInFlight = React.useRef(false);
  const hostMounted = React.useRef(false);
  const [reconcileNonce, scheduleReconcile] = React.useReducer((n: number) => n + 1, 0);
  React.useLayoutEffect(() => {
    hostMounted.current = true;
    return () => {
      hostMounted.current = false;
      staleReconcilePending.current = false;
    };
  }, []);
  const currentHostRef = React.useRef({
    capture: state.captureMutationReceipt,
    refreshViewer: state.refresh,
    refreshPublic: refreshPublicRead,
  });
  currentHostRef.current = {
    capture: state.captureMutationReceipt,
    refreshViewer: state.refresh,
    refreshPublic: refreshPublicRead,
  };
  const reconcileCurrent = React.useCallback(async () => {
    if (!hostMounted.current || reconcileInFlight.current || !staleReconcilePending.current) return;
    const current = currentHostRef.current;
    const receipt = current.capture();
    if (!receipt) return;
    staleReconcilePending.current = false;
    reconcileInFlight.current = true;
    try {
      await current.refreshPublic();
    } catch {
      // A failed public read still requires a fresh private read below.
    } finally {
      reconcileInFlight.current = false;
    }
    if (!hostMounted.current) return;
    if (receipt()) current.refreshViewer();
    else {
      // The successor may have committed while this read was pending and
      // the effect may already have observed pending=false. Wake it again.
      staleReconcilePending.current = true;
      scheduleReconcile();
    }
  }, []);
  React.useEffect(() => {
    if (staleReconcilePending.current) void reconcileCurrent();
  }, [state.captureMutationReceipt, state.loading, reconcileNonce, reconcileCurrent]);
  const runMutation = React.useCallback(async (
    presentation: SlotMutationPresentation,
    mutate: SlotMutationAction,
    onOutcome?: SlotMutationOutcomeHandler,
  ): Promise<SlotMutationHostResult> => {
    if (inFlight.current || reconcileInFlight.current) return { kind: "busy" };
    const receipt = state.captureMutationReceipt();
    if (!receipt) return { kind: "stale" };
    if (staleReconcilePending.current) {
      // A new committed receipt still owes a read-only reconciliation.
      // Do not start a second POST against an unreconciled snapshot.
      void reconcileCurrent();
      return { kind: "busy" };
    }
    inFlight.current = true;
    try {
      const outcome = await runSlotMutation(presentation, mutate, () => currentPath);
      if (!receipt()) {
        if (outcome.refresh) {
          staleReconcilePending.current = true;
          await reconcileCurrent();
        }
        return { kind: "stale" };
      }
      if (outcome.kind === "redirect") {
        navigate(outcome.path);
        return { kind: "settled", outcome, isCurrent: receipt };
      }
      onOutcome?.(outcome, receipt);
      if (outcome.refresh && hostMounted.current) {
        // The callback itself may synchronously retire this receipt.
        if (receipt()) {
          try {
            await refreshPublicRead();
          } catch {
            // The private RH-014 read below still runs after an RH-020 failure.
          }
          if (receipt()) {
            state.refresh();
            return { kind: "settled", outcome, isCurrent: receipt };
          }
        }
        if (hostMounted.current) {
          staleReconcilePending.current = true;
          await reconcileCurrent();
        }
      }
      return { kind: "settled", outcome, isCurrent: receipt };
    } finally {
      inFlight.current = false;
    }
  }, [state.captureMutationReceipt, state.refresh, currentPath, refreshPublicRead, navigate, reconcileCurrent]);
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
    children({ ...state, runMutation }),
  );
}
