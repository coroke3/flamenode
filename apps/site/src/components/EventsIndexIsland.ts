import React from "react";
import { EventsIndexView } from "@flamenode/ui";
import type { StaticEventsIndex } from "../../../../src/lib/publicData/staticEventsIndexCore.ts";
import { buildEventsIndexModel, parseEventsQuery } from "../lib/eventIndex.ts";
import { IslandWrapper } from "./IslandWrapper.ts";

export interface EventsIndexIslandProps {
  /** null = the build could not read the index (CURRENT's "temporarily unavailable" notice). */
  index: StaticEventsIndex | null;
  /** Build time (unix seconds). The static HTML is the default view at this instant. */
  builtAt: number;
}

const GROUP_HASH_PREFIX = "event-group-";

function decodeHash(hash: string): string | null {
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return null;
  }
}

/**
 * `/event` as one Island (MIG-0502 U01). The server HTML and the first client render are the default view
 * (no query, build time), so hydration matches. After mount it reads `location.search` and the clock, which
 * is what CURRENT's `~query` twin route and request-time status did: `/event?q=&status=&sort=` is the same
 * static page filtered in the browser, and reload / back / forward keep working because the URL carries the state.
 */
export function EventsIndexIsland({ index, builtAt }: EventsIndexIslandProps): React.ReactElement {
  const [live, setLive] = React.useState<{ search: string; now: number }>({ search: "", now: builtAt });
  React.useEffect(() => {
    setLive({ search: window.location.search, now: Math.floor(Date.now() / 1000) });
  }, []);
  // CURRENT EventGroupHashScroll: `/event#event-group-{slug}` scrolls smoothly to the section.
  React.useEffect(() => {
    const id = window.location.hash.length > 1 ? decodeHash(window.location.hash) : null;
    if (!id || !id.startsWith(GROUP_HASH_PREFIX)) return;
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, []);
  const model = React.useMemo(
    () => buildEventsIndexModel(index, parseEventsQuery(live.search), live.now),
    [index, live],
  );
  return React.createElement(IslandWrapper, null, React.createElement(EventsIndexView, { model }));
}

export default EventsIndexIsland;
