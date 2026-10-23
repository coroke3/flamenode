import React from "react";
import { EventDetailView } from "@flamenode/ui";
import type { StaticEventDetail } from "../../../../src/lib/publicData/staticEventDetailCore.ts";
import { buildEventDetailData, type LiveSlotStatus } from "../lib/eventDetail.ts";
import { fetchLiveSlots } from "../lib/liveSlots.ts";
import { IslandWrapper } from "./IslandWrapper.ts";

export interface EventDetailIslandProps {
  detail: StaticEventDetail;
  /** Build time (unix seconds): the server HTML and the first client render use it. */
  builtAt: number;
}

/**
 * `/event/[id]` as one Island (MIG-0502 U02/U03). Static HTML = CURRENT's page at build time with no slot
 * state (`–` counts). After mount: the clock refreshes the status / entry button / day metric (CURRENT computed
 * them per request), and RH-020 fills the slot counts. If the live API fails the static body stays (T05).
 */
export function EventDetailIsland({ detail, builtAt }: EventDetailIslandProps): React.ReactElement {
  const [now, setNow] = React.useState(builtAt);
  const [live, setLive] = React.useState<LiveSlotStatus | null>(null);
  React.useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    if (detail.slots.length === 0) return;
    const controller = new AbortController();
    void fetchLiveSlots(detail.event.id, controller.signal).then((result) => {
      if (result) setLive(result);
    });
    return () => controller.abort();
  }, [detail]);
  const event = React.useMemo(() => buildEventDetailData(detail, now, live), [detail, now, live]);
  return React.createElement(IslandWrapper, null, React.createElement(EventDetailView, { event }));
}

export default EventDetailIsland;
