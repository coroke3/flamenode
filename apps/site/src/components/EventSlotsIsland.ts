import React from "react";
import { EventSlotsView } from "@flamenode/ui";
import type { StaticEventDetail } from "../../../../src/lib/publicData/staticEventDetailCore.ts";
import { buildEventSlotsModel, type SlotsLivePhase } from "../lib/eventSlots.ts";
import { fetchLiveSlots, type LiveSlots } from "../lib/liveSlots.ts";
import { IslandWrapper } from "./IslandWrapper.ts";

export interface EventSlotsIslandProps {
  detail: StaticEventDetail;
  builtAt: number;
}

/** Re-read the live state while the page stays open (CURRENT ISR revalidate was 30 s). */
const REFRESH_MS = 30_000;

/**
 * `/event/[id]/slots` as one Island (MIG-0502 U03). Server HTML: header + the slot time grid with every slot
 * "読み込み中" (no slot state is baked). After mount it reads RH-020 and refreshes every 30 s; a failed read
 * keeps the grid and shows a notice (T05). The reservation controls belong to MIG-0604 / MIG-0606.
 */
export function EventSlotsIsland({ detail, builtAt }: EventSlotsIslandProps): React.ReactElement {
  const [now, setNow] = React.useState(builtAt);
  const [phase, setPhase] = React.useState<SlotsLivePhase>("loading");
  const [live, setLive] = React.useState<LiveSlots | null>(null);
  React.useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setNow(Math.floor(Date.now() / 1000));
      const result = await fetchLiveSlots(detail.event.id, controller.signal);
      if (controller.signal.aborted) return;
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
  return React.createElement(IslandWrapper, null, React.createElement(EventSlotsView, { model }));
}

export default EventSlotsIsland;
