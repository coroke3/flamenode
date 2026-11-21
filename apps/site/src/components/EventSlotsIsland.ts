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
  React.useEffect(() => {
    const controller = new AbortController();
    // Two 30-second polls can overlap. An older RH-020 response must never
    // overwrite the grid after a newer poll has started and completed.
    let latestRequest = 0;
    const load = async () => {
      const request = ++latestRequest;
      setNow(Math.floor(Date.now() / 1000));
      const result = await fetchLiveSlots(detail.event.id, controller.signal);
      if (controller.signal.aborted || request !== latestRequest) return;
      if (result) {
        setLive(result);
        setPhase("ready");
      } else {
        setPhase((current) => (current === "ready" ? current : "unavailable"));
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [detail]);
  const model = React.useMemo(() => buildEventSlotsModel(detail, now, phase, live), [detail, now, phase, live]);
  // U03a: private RH-014 read is mounted only for hydration notices; write controls
  // and private slot names remain unmounted until approved MIG-0657 + U03b/U04.
  // Stable public IDs avoid repeated private re-reads during overlay state renders.
  const publicSlotIds = React.useMemo(
    () => slotLayoutOf(detail).map((slot) => ({ id: slot.id })),
    [detail],
  );
  return React.createElement(
    IslandWrapper, null,
    React.createElement(
      EventSlotsViewerIsland,
      {
        eventId: detail.event.id,
        baseSlots: publicSlotIds,
        accepting: isAcceptingEntries(detail.event, now),
        eventStatus: computeEventStatus(detail.event, now),
      },
      (viewer) => {
        // U03b1 is visual-only: RH-020 remains the public name/status authority.
        // Reveal ownership only after a current, valid RH-014 session overlay;
        // never label an RH-020 "available" slot as owned, even if the viewer
        // response is stale. No private X ID/name or mutation control is rendered.
        const owned = new Set(
          viewer.canManageOwnSlots
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
        return React.createElement(EventSlotsView, { model: viewerModel });
      },
    ),
  );
}

export default EventSlotsIsland;
