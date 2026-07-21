"use client";

import * as React from "react";

const EVENT_GROUP_HASH_PREFIX = "event-group-";

/** `/event#event-group-{slug}` 読込時に該当セクションへスクロールする。 */
export function EventGroupHashScroll(): null {
  React.useEffect(() => {
    const raw = window.location.hash;
    if (!raw || raw.length < 2) return;

    const id = decodeURIComponent(raw.slice(1));
    if (!id.startsWith(EVENT_GROUP_HASH_PREFIX)) return;

    const scrollToTarget = () => {
      document.getElementById(id)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    };

    requestAnimationFrame(scrollToTarget);
  }, []);

  return null;
}
