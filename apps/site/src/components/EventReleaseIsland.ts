import React from "react";
import { EventReleaseView, type EventReleaseViewModel, type ReleaseMode } from "@flamenode/ui";
import { IslandWrapper } from "./IslandWrapper.ts";

export interface EventReleaseIslandProps {
  model: EventReleaseViewModel;
}

/** CURRENT `resolveInitialMode`: `#grid` / `#creator`, anything else is the list. */
export function modeFromHash(hash: string): ReleaseMode {
  const value = hash.replace(/^#/, "").toLowerCase();
  return value === "grid" || value === "creator" ? value : "list";
}

/**
 * `/event/[id]/release` as one Island (MIG-0502 U04). The server HTML is the list view; after mount the mode
 * follows the URL hash (`#list | #grid | #creator`), exactly like CURRENT, and the buttons keep it in sync with
 * `history.replaceState`.
 */
export function EventReleaseIsland({ model }: EventReleaseIslandProps): React.ReactElement {
  const [mode, setMode] = React.useState<ReleaseMode>("list");
  React.useEffect(() => {
    const sync = (next: ReleaseMode) => {
      try {
        const url = new URL(window.location.href);
        if (url.hash.replace(/^#/, "").toLowerCase() === next) return;
        url.hash = next;
        window.history.replaceState(null, "", url);
      } catch {
        /* ignore isolated history failures */
      }
    };
    const initial = modeFromHash(window.location.hash);
    setMode(initial);
    sync(initial);
    const onHashChange = () => setMode(modeFromHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  const change = (next: ReleaseMode) => {
    setMode(next);
    try {
      const url = new URL(window.location.href);
      url.hash = next;
      window.history.replaceState(null, "", url);
    } catch {
      /* ignore */
    }
  };
  return React.createElement(
    IslandWrapper,
    null,
    React.createElement(EventReleaseView, { model, mode, onModeChange: change }),
  );
}

export default EventReleaseIsland;
