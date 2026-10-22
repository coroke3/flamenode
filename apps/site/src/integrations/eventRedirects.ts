/**
 * Build-time `_redirects` lines for events (MIG-0502 U06 / coverage gap G19).
 * CURRENT `/event/{id}/slots` calls `redirect("/event/{id}")` when the event has no slots; Next answers 307.
 * A static build has no request handler, and Astro's own `redirects` config would emit a meta-refresh HTML
 * (200, not 30x), so the zero-slot events are written to the Workers Static Assets `_redirects` file with an
 * explicit 307. Events that do have slots get a real page (`pages/event/[id]/slots.astro`).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getEventBuildData } from "../lib/eventData.ts";

export const EVENT_REDIRECTS_BEGIN = "# BEGIN generated: event slots redirects (MIG-0502)";
export const EVENT_REDIRECTS_END = "# END generated: event slots redirects (MIG-0502)";

export function eventSlotsRedirectLines(
  details: Iterable<{ event: { id: string }; slots: readonly unknown[] }>,
): string[] {
  const lines: string[] = [];
  for (const detail of details) {
    if (detail.slots.length === 0) lines.push(`/event/${detail.event.id}/slots /event/${detail.event.id} 307`);
  }
  return lines.sort();
}

/** Replaces the generated block in an existing `_redirects` text (or appends it); the rest is kept as is. */
export function mergeEventRedirects(existing: string, lines: readonly string[]): string {
  const block = lines.length > 0 ? `${EVENT_REDIRECTS_BEGIN}\n${lines.join("\n")}\n${EVENT_REDIRECTS_END}\n` : "";
  const begin = existing.indexOf(EVENT_REDIRECTS_BEGIN);
  const end = existing.indexOf(EVENT_REDIRECTS_END);
  const base =
    begin >= 0 && end > begin
      ? existing.slice(0, begin) + existing.slice(end + EVENT_REDIRECTS_END.length).replace(/^\n/, "")
      : existing;
  const trimmed = base.length > 0 && !base.endsWith("\n") ? `${base}\n` : base;
  return `${trimmed}${block}`;
}

export function eventRedirects() {
  return {
    name: "flamenode-event-redirects",
    hooks: {
      "astro:build:done": async ({ dir }: { dir: URL }) => {
        const { details } = await getEventBuildData();
        const lines = eventSlotsRedirectLines(details.values());
        const file = path.join(fileURLToPath(dir), "_redirects");
        const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : "";
        const merged = mergeEventRedirects(existing, lines);
        if (merged !== "" || existing !== "") fs.writeFileSync(file, merged);
      },
    },
  };
}
