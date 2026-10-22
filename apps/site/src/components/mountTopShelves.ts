import React from "react";
import { createRoot } from "react-dom/client";
import { IslandErrorBoundary } from "./IslandWrapper.ts";
import { TopShelfIsland, type TopShelfCard } from "./TopShelfIsland.ts";

/**
 * Takes over the static shelves of the top page (`.shelf[data-shelf]`, rendered by `TopView`) when script runs.
 * The static `ol > li` stays as the fallback and is removed only after the Island has rendered; if the Island
 * throws, the error boundary renders nothing and the native horizontal scroll stays. Each shelf is mounted
 * when it comes near the viewport, so a shelf below the fold costs nothing until it is scrolled to.
 * CURRENT directions (`app/(public)/page.tsx`): trending left, recommend right, latest left, nostalgic right.
 */
const DIRECTION_BY_SHELF: Record<string, "left" | "right"> = {
  trending: "left",
  recommend: "right",
  latest: "left",
  nostalgic: "right",
};
const MOUNT_MARGIN = "300px";

export function readShelfCards(shelf: Element): TopShelfCard[] {
  return Array.from(shelf.querySelectorAll(":scope > ol > li")).map((li, index) => ({ key: `shelf-${index}`, html: li.innerHTML }));
}

export function mountTopShelf(shelf: HTMLElement): void {
  if (shelf.dataset.shelfMounted) return;
  const items = readShelfCards(shelf);
  if (items.length === 0) return;
  shelf.dataset.shelfMounted = "1";
  const host = document.createElement("div");
  host.className = "tls-host";
  shelf.after(host);
  const root = createRoot(host);
  const ready = () => {
    shelf.remove();
  };
  root.render(
    React.createElement(
      IslandErrorBoundary,
      { fallback: null },
      React.createElement(TopShelfIsland, {
        items,
        ariaLabel: shelf.getAttribute("aria-label") ?? undefined,
        autoScrollDirection: DIRECTION_BY_SHELF[shelf.dataset.shelf ?? ""] ?? "left",
        onReady: ready,
      }),
    ),
  );
}

export function mountTopShelves(scope: ParentNode = document): void {
  const shelves = Array.from(scope.querySelectorAll<HTMLElement>(".shelf[data-shelf]"));
  if (typeof IntersectionObserver === "undefined") {
    shelves.forEach(mountTopShelf);
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        mountTopShelf(entry.target as HTMLElement);
      }
    },
    { rootMargin: MOUNT_MARGIN },
  );
  shelves.forEach((shelf) => observer.observe(shelf));
}
