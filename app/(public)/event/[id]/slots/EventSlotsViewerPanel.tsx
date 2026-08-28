"use client";

import * as React from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { SlotGrid, type SlotRow } from "@/components/event/SlotGrid";
import { SlotStatusBoard } from "@/components/event/SlotStatusBoard";
import { ACTIVE_X_CHANGED_EVENT } from "@/lib/client/activeXSwitchEvents";
import { formatUnix } from "@/lib/utils/format";
import type {
  SlotViewerOverlayDto,
  SlotViewerOverlaySlot,
} from "@/lib/slots/slotViewerOverlayCore";
import styles from "./page.module.css";

const SLOT_VIEWER_OVERLAY_TIMEOUT_MS = 5_000;
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

type ViewerOverlayState = {
  value: SlotViewerOverlayDto;
  /** このviewer情報と同時に表示してよいpublic slot base。 */
  baseSlots: readonly SlotRow[] | null;
};

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeSlotPatch(value: unknown): SlotViewerOverlaySlot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string") return null;
  if (
    row.viewer_relation !== "active" &&
    row.viewer_relation !== "unassigned" &&
    row.viewer_relation !== "account_other" &&
    row.viewer_relation !== "none"
  ) {
    return null;
  }
  if (typeof row.is_owned_by_viewer !== "boolean") return null;
  return {
    id: row.id,
    display_name: nullableString(row.display_name),
    reserved_x_id: nullableString(row.reserved_x_id),
    profile_x_user_id: nullableString(row.profile_x_user_id),
    submitted_icon_url: nullableString(row.submitted_icon_url),
    is_owned_by_viewer: row.is_owned_by_viewer,
    viewer_relation: row.viewer_relation,
    group_key: nullableString(row.group_key),
    x_user_id: nullableString(row.x_user_id),
  };
}

function normalizeOverlay(value: unknown): SlotViewerOverlayDto | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.loggedIn !== "boolean" ||
    typeof row.authUnavailable !== "boolean" ||
    typeof row.isBanned !== "boolean" ||
    typeof row.needsTermsAcceptance !== "boolean" ||
    typeof row.canReserveSlot !== "boolean" ||
    typeof row.canPost !== "boolean" ||
    typeof row.operatorOverrideAllowed !== "boolean" ||
    !Array.isArray(row.slots)
  ) {
    return null;
  }
  const slots = row.slots
    .map(normalizeSlotPatch)
    .filter((slot): slot is SlotViewerOverlaySlot => slot !== null);
  return {
    loggedIn: row.loggedIn,
    authUnavailable: row.authUnavailable,
    isBanned: row.isBanned,
    needsTermsAcceptance: row.needsTermsAcceptance,
    canReserveSlot: row.canReserveSlot,
    canPost: row.canPost,
    operatorOverrideAllowed: row.operatorOverrideAllowed,
    viewerXId: nullableString(row.viewerXId),
    viewerXIdNotice: nullableString(row.viewerXIdNotice),
    slots,
  };
}

function mergeViewerSlots(
  baseSlots: readonly SlotRow[],
  overlay: SlotViewerOverlayDto,
): SlotRow[] {
  const byId = new Map(overlay.slots.map((slot) => [slot.id, slot] as const));
  return baseSlots.map((slot) => {
    const patch = byId.get(slot.id);
    if (!patch) {
      return {
        ...slot,
        is_owned_by_viewer: false,
        viewer_relation: "none" as const,
        x_user_id: null,
      };
    }
    return {
      ...slot,
      display_name: patch.display_name ?? slot.display_name,
      reserved_x_id: patch.reserved_x_id ?? slot.reserved_x_id,
      profile_x_user_id: patch.profile_x_user_id ?? slot.profile_x_user_id ?? null,
      submitted_icon_url:
        patch.submitted_icon_url ?? slot.submitted_icon_url ?? null,
      is_owned_by_viewer: patch.is_owned_by_viewer,
      viewer_relation: patch.viewer_relation,
      // public_nameではpage SSRのbase groupを正本にする。hidden/anonymousでは
      // base groupがnullなのでviewer専用opaque groupを補完する。
      group_key: slot.group_key ?? patch.group_key,
      x_user_id: patch.x_user_id,
    };
  });
}

export function EventSlotsViewerPanel({
  eventId,
  eventTitle,
  baseSlots,
  accepting,
  eventStatus,
  slotType,
  maxSlotsPerVideo,
  maxSlotReservationsPerXId,
  slotIntervalSec,
  slotPartGapSec,
  parts,
  entryEndTime,
}: {
  eventId: string;
  eventTitle: string;
  baseSlots: SlotRow[];
  accepting: boolean;
  eventStatus: string;
  slotType: "time" | "count";
  maxSlotsPerVideo: number;
  maxSlotReservationsPerXId: number;
  slotIntervalSec: number | null;
  slotPartGapSec: number;
  parts: string[];
  entryEndTime: number | null;
}): React.ReactElement {
  const [overlayState, setOverlayState] = React.useState<ViewerOverlayState>({
    value: EMPTY_OVERLAY,
    baseSlots: null,
  });
  const [loading, setLoading] = React.useState(true);
  const [refreshNonce, setRefreshNonce] = React.useState(0);

  const overlayIsCurrent = overlayState.baseSlots === baseSlots;
  const viewerOverlay = overlayIsCurrent ? overlayState.value : EMPTY_OVERLAY;
  const viewerLoading = loading || !overlayIsCurrent;

  React.useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(
      () => controller.abort(),
      SLOT_VIEWER_OVERLAY_TIMEOUT_MS,
    );
    const requestBaseSlots = baseSlots;
    setLoading(true);
    void fetch(
      `/api/events/${encodeURIComponent(eventId)}/slots/viewer-overlay`,
      {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        if (!response.ok) {
          return { ...EMPTY_OVERLAY, authUnavailable: true };
        }
        const normalized = normalizeOverlay(await response.json());
        return normalized ?? { ...EMPTY_OVERLAY, authUnavailable: true };
      })
      .catch((error) => {
        if (!active) return null;
        console.warn("[event-slots] viewer overlay unavailable", {
          error: error instanceof Error ? error.name : "unknown",
        });
        return { ...EMPTY_OVERLAY, authUnavailable: true };
      })
      .then((value) => {
        if (!active || !value) return;
        setOverlayState({ value, baseSlots: requestBaseSlots });
        setLoading(false);
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
      });
    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [eventId, refreshNonce, baseSlots]);

  React.useEffect(() => {
    const refresh = () => {
      // Active X切替直後に旧Xの本人枠・表示名を残さない。
      setOverlayState({ value: EMPTY_OVERLAY, baseSlots: null });
      setLoading(true);
      setRefreshNonce((value) => value + 1);
    };
    window.addEventListener(ACTIVE_X_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(ACTIVE_X_CHANGED_EVENT, refresh);
  }, []);

  const mergedSlots = React.useMemo(
    () => mergeViewerSlots(baseSlots, viewerOverlay),
    [baseSlots, viewerOverlay],
  );
  const canManageOwnSlots =
    !viewerLoading &&
    viewerOverlay.loggedIn &&
    !viewerOverlay.authUnavailable &&
    !viewerOverlay.isBanned &&
    !viewerOverlay.needsTermsAcceptance;
  const slots = React.useMemo(
    () =>
      canManageOwnSlots
        ? mergedSlots
        : mergedSlots.map((slot) => ({
            ...slot,
            // 表示情報は維持してもwrite ownershipだけはfail-closed。
            is_owned_by_viewer: false,
          })),
    [mergedSlots, canManageOwnSlots],
  );
  const currentPath = `/event/${eventId}/slots`;
  const canTakeSlot =
    !viewerLoading &&
    !viewerOverlay.authUnavailable &&
    !viewerOverlay.isBanned &&
    viewerOverlay.canReserveSlot &&
    (accepting || viewerOverlay.operatorOverrideAllowed);

  let notice: React.ReactNode = null;
  if (!accepting && !viewerOverlay.operatorOverrideAllowed) {
    notice = (
      <>
        <Icon name="info" size={13} aria-hidden />
        {eventStatus === "ended"
          ? "終了済みのため新規確保はできません。"
          : eventStatus === "scheduled"
            ? "受付開始までお待ちください。"
            : "現在は受付停止中です。"}
      </>
    );
  } else if (viewerLoading) {
    notice = (
      <>
        <Icon name="info" size={13} aria-hidden /> ログイン状態を確認しています。
      </>
    );
  } else if (viewerOverlay.authUnavailable) {
    notice = (
      <>
        <Icon name="warning" size={13} aria-hidden />
        ログイン状態を一時的に確認できません。時間をおいて再読み込みしてください。
      </>
    );
  } else if (!viewerOverlay.loggedIn) {
    notice = (
      <>
        <Icon name="info" size={13} aria-hidden /> 確保には
        <Link
          href={`/entry?next=${encodeURIComponent(currentPath)}`}
          prefetch={false}
        >
          ログイン
        </Link>
        が必要です。
      </>
    );
  } else if (viewerOverlay.isBanned) {
    notice = (
      <>
        <Icon name="warning" size={13} aria-hidden />
        現在、このアカウントは利用停止中です。
      </>
    );
  } else if (viewerOverlay.needsTermsAcceptance) {
    notice = (
      <>
        <Icon name="info" size={13} aria-hidden /> 確保には
        <Link
          href={`/rules?next=${encodeURIComponent(currentPath)}`}
          prefetch={false}
        >
          利用規約への同意
        </Link>
        が必要です。
      </>
    );
  } else if (!accepting && viewerOverlay.operatorOverrideAllowed) {
    notice = (
      <>
        <Icon name="warning" size={13} aria-hidden />
        イベント運営権限で、募集開始前の枠確保やイベント上限を超える予約ができます。実行時に警告を確認してください。
      </>
    );
  }

  return (
    <>
      {notice ? <p className={styles.notice}>{notice}</p> : null}
      {viewerOverlay.viewerXIdNotice ? (
        <p className={styles.notice}>
          <Icon name="info" size={13} aria-hidden /> {viewerOverlay.viewerXIdNotice}
        </p>
      ) : null}

      <div className={styles.layout}>
        <div className={styles.main}>
          <SlotGrid
            slots={slots}
            viewerXId={viewerOverlay.viewerXId}
            isAuthenticated={
              viewerOverlay.loggedIn &&
              !viewerOverlay.authUnavailable &&
              !viewerOverlay.isBanned &&
              !viewerOverlay.needsTermsAcceptance
            }
            canReserve={accepting}
            canTakeSlot={canTakeSlot}
            operatorOverrideAllowed={viewerOverlay.operatorOverrideAllowed}
            canPost={viewerOverlay.canPost && !viewerOverlay.isBanned}
            slotType={slotType}
            maxSlotsPerVideo={maxSlotsPerVideo}
            maxSlotReservationsPerXId={maxSlotReservationsPerXId}
            slotIntervalSec={slotIntervalSec}
            slotPartGapSec={slotPartGapSec}
            parts={parts}
          />
        </div>
        <aside className={styles.aside}>
          <SlotStatusBoard
            slots={slots}
            slotPartGapSec={slotPartGapSec}
            eventTitle={eventTitle}
            slotFormatLabel={slotType === "count" ? "番号枠" : "時間枠"}
            deadlineLabel={
              entryEndTime != null ? formatUnix(entryEndTime) : null
            }
            parts={parts}
          />
        </aside>
      </div>
    </>
  );
}
