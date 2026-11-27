import React from "react";
import { EventSlotsView, type EventSlotsViewModel } from "@flamenode/ui";
import type { EventIslandDetail } from "../lib/eventDetail.ts";
import { buildEventSlotsModel, type SlotsLivePhase } from "../lib/eventSlots.ts";
import { fetchLiveSlots, type LiveSlots } from "../lib/liveSlots.ts";
import { IslandWrapper } from "./IslandWrapper.ts";
import { EventSlotsViewerIsland } from "./EventSlotsViewerIsland.ts";
import { slotLayoutOf } from "../lib/eventDetail.ts";
import { computeEventStatus, isAcceptingEntries } from "../../../../src/lib/utils/eventStatusCore.ts";

export interface EventSlotsIslandProps {
  detail: EventIslandDetail;
  builtAt: number;
}

/** Re-read the live state while the page stays open (CURRENT ISR revalidate was 30 s). */
const REFRESH_MS = 30_000;
/** RH-020 is best effort; never leave the public grid waiting on a hung request. */
const LIVE_READ_TIMEOUT_MS = 5_000;

/**
 * `/event/[id]/slots` as one Island (MIG-0502 U03). Server HTML: header + the slot time grid with every slot
 * "読み込み中" (no slot state is baked). After mount it reads RH-020 and refreshes every 30 s; a failed read
 * keeps the grid and shows a notice (T05). The reservation controls belong to MIG-0604 / MIG-0606.
 */
// Astro normally navigates between event pages, but the Island may also be
// reused by client navigation. Remount both the RH-020 public state and nested
// RH-014 private overlay whenever the event identity changes, even when slot
// IDs are reused. A stale previous event must never paint a new event.
export function EventSlotsIsland(props: EventSlotsIslandProps): React.ReactElement {
  return React.createElement(EventSlotsIslandForEvent, { ...props, key: props.detail.event.id });
}

function EventSlotsIslandForEvent({ detail, builtAt }: EventSlotsIslandProps): React.ReactElement {
  const [now, setNow] = React.useState(builtAt);
  const [phase, setPhase] = React.useState<SlotsLivePhase>("loading");
  const [live, setLive] = React.useState<LiveSlots | null>(null);
  const [stalePublicNotice, setStalePublicNotice] = React.useState(false);
  // RH-014 is a snapshot of per-viewer ownership, NOT a permanent claim for
  // a slot ID. A subsequent RH-020 success can mean that the slot was released
  // and reserved by another account without changing the public layout.
  const [viewerRefreshEpoch, setViewerRefreshEpoch] = React.useState(0);
  const publicRefreshRef = React.useRef<(() => Promise<boolean>) | null>(null);
  const refreshPublic = React.useCallback(
    () => publicRefreshRef.current?.() ?? Promise.resolve(false),
    [],
  );
  React.useEffect(() => {
    const controller = new AbortController();
    // Two 30-second polls can overlap. An older RH-020 response must never
    // overwrite the grid after a newer poll has started and completed.
    let latestRequest = 0;
    let activeRequestController: AbortController | null = null;
    // First successful read after an earlier failure must also invalidate
    // RH-014 fetched during that failed initial poll.
    let hasSettledPublicRead = false;
    const load = async (refreshViewerOnSuccess = true): Promise<boolean> => {
      const request = ++latestRequest;
      activeRequestController?.abort();
      setNow(Math.floor(Date.now() / 1000));
      // The common effect controller only aborts on unmount. An unanswered
      // RH-020 fetch could otherwise leave the initial grid "loading" forever.
      // Race a finite deadline even when a custom fetch ignores AbortSignal.
      const requestController = new AbortController();
      activeRequestController = requestController;
      const abortOnUnmount = () => requestController.abort();
      controller.signal.addEventListener("abort", abortOnUnmount, { once: true });
      let deadlineId: number | undefined;
      const deadline = new Promise<null>((resolve) => {
        deadlineId = window.setTimeout(() => {
          requestController.abort();
          resolve(null);
        }, LIVE_READ_TIMEOUT_MS);
      });
      let result: LiveSlots | null;
      try {
        result = await Promise.race([
          fetchLiveSlots(detail.event.id, requestController.signal),
          deadline,
        ]);
      } catch {
        result = null;
      } finally {
        if (deadlineId !== undefined) window.clearTimeout(deadlineId);
        controller.signal.removeEventListener("abort", abortOnUnmount);
        if (activeRequestController === requestController) activeRequestController = null;
      }
      if (controller.signal.aborted || request !== latestRequest) return false;
      if (result) {
        setLive(result);
        setPhase("ready");
        setStalePublicNotice(false);
        // A first *completed* public read does not duplicate RH-014.
        // Success after ANY preceding completed attempt (including 503) must
        // invalidate that prior identity snapshot before showing ownership.
        if (refreshViewerOnSuccess && hasSettledPublicRead) setViewerRefreshEpoch((n) => n + 1);
        hasSettledPublicRead = true;
        return true;
      } else {
        // A failed *refresh* preserves the last successfully fetched grid, but
        // must not imply that these slot names/states were just revalidated.
        // Initial RH-020 failures keep their existing unavailable notice.
        setStalePublicNotice(true);
        hasSettledPublicRead = true;
        setPhase((current) => (current === "ready" ? current : "unavailable"));
        return false;
      }
    };
    const refreshPublicRequest = () => load(false);
    publicRefreshRef.current = refreshPublicRequest;
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      controller.abort();
      activeRequestController?.abort();
      if (publicRefreshRef.current === refreshPublicRequest) publicRefreshRef.current = null;
      window.clearInterval(timer);
    };
  }, [detail]);
  const model = React.useMemo(() => buildEventSlotsModel(detail, now, phase, live), [detail, now, phase, live]);
  // U03a: private RH-014 read is mounted only for hydration notices; write controls
  // and private slot names remain unmounted until approved MIG-0657 + U03b/U04.
  // Slot IDs remain public-only. Changing the array identity on a later
  // successful RH-020 read forces useEventSlotsViewer to discard its old RH-014
  // owner claims immediately, even when the exact same IDs remain reserved.
  // Other state rerenders cannot trigger a private fetch loop.
  const publicSlotIds = React.useMemo(
    () => slotLayoutOf(detail).map((slot) => ({ id: slot.id })),
    [detail, viewerRefreshEpoch],
  );
  return React.createElement(
    IslandWrapper,
    null,
    phase === "ready"
      ? React.createElement(
          EventSlotsViewerIsland,
          {
            eventId: detail.event.id,
            baseSlots: publicSlotIds,
            accepting: isAcceptingEntries(detail.event, now),
            eventStatus: computeEventStatus(detail.event, now),
            refreshPublic,
          },
          (viewer) => {
            // RH-014 may only annotate a public slot snapshot that has already
            // succeeded. Mounting this child after RH-020 reaches ready makes
            // the first private read causally follow the public baseline.
            // A private response that arrived before the first RH-020 result
            // can therefore never label a reassigned reservation as "mine".
            const owned = new Set(
              viewer.canManageOwnSlots && !stalePublicNotice
                ? viewer.slots.filter((slot) => slot.is_owned_by_viewer).map((slot) => slot.id)
                : [],
            );
            const viewerModel: EventSlotsViewModel = owned.size === 0 ? model : {
              ...model,
              days: model.days.map((day) => ({
                ...day,
                blocks: day.blocks.map((block) =>
                  block.kind === "slot" && block.state === "taken" && owned.has(block.id)
                    ? { ...block, ownedByViewer: true }
                    : block,
                ),
              })),
            };
            // The public view owns the .ev-scope styles and visible slot grid;
            // keep its stale-refresh notice inside that root.
            const displayedModel: EventSlotsViewModel = stalePublicNotice
              ? { ...viewerModel, stalePublicNotice: true }
              : viewerModel;
            return React.createElement(EventSlotsView, { model: displayedModel });
          },
        )
      : React.createElement(EventSlotsView, { model }),
  );}

export default EventSlotsIsland;
