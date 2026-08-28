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
      group_key: patch.group_key ?? slot.group_key,
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
  const [overlay, setOverlay] = React.useState<SlotViewerOverlayDto>(EMPTY_OVERLAY);
  const [loading, setLoading] = React.useState(true);
  const [refreshNonce, setRefreshNonce] = React.useState(0);
  const previousBaseSlotsRef = React.useRef(baseSlots);

  React.useEffect(() => {
    let active = true;
    const controller = new AbortController();
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
          return { ...EMPTY_OVERLAY, authUnavailable: response.status >= 500 };
        }
        const normalized = normalizeOverlay(await response.json());
        return normalized ?? { ...EMPTY_OVERLAY, authUnavailable: true };
      })
      .catch((error) => {
        if (controller.signal.aborted) return null;
        console.warn("[event-slots] viewer overlay unavailable", {
          error: error instanceof Error ? error.name : "unknown",
        });
        return { ...EMPTY_OVERLAY, authUnavailable: true };
      })
      .then((value) => {
        if (!active || !value) return;
        setOverlay(value);
        setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [eventId, refreshNonce]);

  React.useEffect(() => {
    const refresh = () => setRefreshNonce((value) => value + 1);
    window.addEventListener(ACTIVE_X_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(ACTIVE_X_CHANGED_EVENT, refresh);
  }, []);

  // SlotGridのmutation成功後はrouter.refresh()でpublic slotsが更新される。
  // Client Component stateはRSC refreshで保持されるため、base配列の更新を検知して
  // viewer ownershipも取り直し、解放済み枠を本人枠として残さない。
  React.useEffect(() => {
    if (previousBaseSlotsRef.current === baseSlots) return;
    previousBaseSlotsRef.current = baseSlots;
    setRefreshNonce((value) => value + 1);
  }, [baseSlots]);

  const slots = React.useMemo(
    () => mergeViewerSlots(baseSlots, overlay),
    [baseSlots, overlay],
  );
  const currentPath = `/event/${eventId}/slots`;
  const canTakeSlot =
    !loading &&
    !overlay.authUnavailable &&
    !overlay.isBanned &&
    overlay.canReserveSlot &&
    (accepting || overlay.operatorOverrideAllowed);

  let notice: React.ReactNode = null;
  if (!accepting && !overlay.operatorOverrideAllowed) {
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
  } else if (loading) {
    notice = (
      <>
        <Icon name="info" size={13} aria-hidden /> ログイン状態を確認しています。
      </>
    );
  } else if (overlay.authUnavailable) {
    notice = (
      <>
        <Icon name="warning" size={13} aria-hidden />
        ログイン状態を一時的に確認できません。時間をおいて再読み込みしてください。
      </>
    );
  } else if (!overlay.loggedIn) {
    notice = (
      <>
        <Icon name="info" size={13} aria-hidden /> 確保には
        <Link href={`/entry?next=${encodeURIComponent(currentPath)}`}>ログイン</Link>
        が必要です。
      </>
    );
  } else if (overlay.isBanned) {
    notice = (
      <>
        <Icon name="warning" size={13} aria-hidden />
        現在、このアカウントは利用停止中です。
      </>
    );
  } else if (overlay.needsTermsAcceptance) {
    notice = (
      <>
        <Icon name="info" size={13} aria-hidden /> 確保には
        <Link href={`/rules?next=${encodeURIComponent(currentPath)}`}>
          利用規約への同意
        </Link>
        が必要です。
      </>
    );
  } else if (!accepting && overlay.operatorOverrideAllowed) {
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
      {overlay.viewerXIdNotice ? (
        <p className={styles.notice}>
          <Icon name="info" size={13} aria-hidden /> {overlay.viewerXIdNotice}
        </p>
      ) : null}

      <div className={styles.layout}>
        <div className={styles.main}>
          <SlotGrid
            slots={slots}
            viewerXId={overlay.viewerXId}
            isAuthenticated={
              overlay.loggedIn && !overlay.authUnavailable && !overlay.isBanned
            }
            canReserve={accepting}
            canTakeSlot={canTakeSlot}
            operatorOverrideAllowed={overlay.operatorOverrideAllowed}
            canPost={overlay.canPost && !overlay.isBanned}
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
