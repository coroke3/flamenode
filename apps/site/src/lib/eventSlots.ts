/**
 * `/event/[id]/slots` view model (MIG-0502 U03). The slot grid layout (ids, times, parts) comes from the
 * build; the state of each slot (open / taken / names / counts) comes only from the live read (RH-020) in
 * the browser, so the static HTML carries no slot state. Header badges follow CURRENT's request-time clock,
 * refreshed by the Island.
 */
import type { BadgeStatus, EventSlotsViewModel, SlotsBlock, SlotsDay } from "@flamenode/ui";
import type { StaticEventDetail } from "../../../../src/lib/publicData/staticEventDetailCore.ts";
import { buildSlotParts } from "../../../../src/lib/utils/slotGroupingCore.ts";
import { computeEventStatus, eventStatusLabel, isAcceptingEntries } from "../../../../src/lib/utils/eventStatusCore.ts";
import { formatUnix } from "../../../../src/lib/utils/format.ts";
import { slotLayoutOf } from "./eventDetail.ts";
import type { LiveSlots } from "./liveSlots.ts";

export type SlotsLivePhase = "loading" | "ready" | "unavailable";

const JST = "Asia/Tokyo";
const dayParts = new Intl.DateTimeFormat("ja-JP", { timeZone: JST, month: "2-digit", day: "2-digit", weekday: "short" });
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: JST, year: "numeric", month: "2-digit", day: "2-digit" });

function dayLabel(unix: number): string {
  const parts = dayParts.formatToParts(new Date(unix * 1000));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("month")}/${get("day")}(${get("weekday")})`;
}

function partLabel(index: number, configured: readonly string[]): string {
  return configured[index - 1]?.trim() || `第${index}部`;
}

const statusTone = (status: ReturnType<typeof computeEventStatus>): BadgeStatus =>
  status === "scheduled" ? "warning" : status === "ended" ? "draft" : "live";

export function buildEventSlotsModel(
  detail: StaticEventDetail,
  now: number,
  phase: SlotsLivePhase,
  live: LiveSlots | null,
): EventSlotsViewModel {
  const { event } = detail;
  const status = computeEventStatus(event, now);
  const accepting = isAcceptingEntries(event, now);
  const entryNotStartedYet = !accepting && event.entry_start_time != null && now < event.entry_start_time;
  const entryClosed = !accepting && event.entry_end_time != null && now >= event.entry_end_time;
  const layout = slotLayoutOf(detail);
  const liveById = phase === "ready" && live ? new Map(live.slots.map((s) => [s.id, s])) : null;
  const isFilled = (id: string): boolean => {
    const s = liveById?.get(id);
    return s != null && s.status !== "available";
  };

  const gapSec = (event.slot_part_gap_minutes ?? 15) * 60;
  const parts = buildSlotParts([...layout], gapSec);
  const multiPart = parts.length > 1;
  const days: { key: string; label: string; blocks: SlotsBlock[]; ids: string[] }[] = [];
  let counter = 0;
  for (const part of parts) {
    const key = part.start_time != null ? dayKey.format(new Date(part.start_time * 1000)) : "none";
    let day = days.find((d) => d.key === key);
    if (!day) {
      day = { key, label: part.start_time != null ? dayLabel(part.start_time) : "時間なし枠", blocks: [], ids: [] };
      days.push(day);
    }
    const previous = day.blocks.length > 0 ? parts[parts.indexOf(part) - 1] : null;
    if (previous && previous.last_start_time != null && part.start_time != null) {
      const range = `${formatUnix(previous.last_start_time, { timeOnly: true })} – ${formatUnix(part.start_time, { timeOnly: true })}`;
      day.blocks.push({ kind: "gap", range });
    }
    if (multiPart) day.blocks.push({ kind: "part", label: partLabel(part.index, event.parts) });
    for (const row of part.rows) {
      counter += 1;
      day.ids.push(row.id);
      const time = row.start_time != null ? formatUnix(row.start_time, { timeOnly: true }) : `#${counter}`;
      const liveRow = liveById?.get(row.id);
      const state = phase === "loading" ? "pending" : !liveRow ? "unknown" : liveRow.status === "available" ? "open" : "taken";
      day.blocks.push({ kind: "slot", id: row.id, time, state, name: state === "taken" ? liveRow?.display_name ?? null : null });
    }
  }

  const total = layout.length;
  const filled = layout.filter((r) => isFilled(r.id)).length;
  const dayModels: SlotsDay[] = days.map((d) => ({
    key: d.key,
    label: d.label,
    filled: liveById ? `${d.ids.filter(isFilled).length} / ${d.ids.length}` : null,
    blocks: d.blocks,
  }));
  return {
    eventId: event.id,
    title: event.title,
    statusLabel: eventStatusLabel(status),
    statusTone: statusTone(status),
    entryBadge: accepting
      ? { label: "受付中", tone: "public" }
      : entryNotStartedYet
        ? { label: "募集開始前", tone: "warning" }
        : entryClosed
          ? { label: "募集終了", tone: "draft" }
          : null,
    periodLabel:
      event.entry_start_time != null || event.entry_end_time != null
        ? `募集: ${event.entry_start_time != null ? formatUnix(event.entry_start_time) : "-"} - ${
            event.entry_end_time != null ? formatUnix(event.entry_end_time) : "-"
          }`
        : null,
    live: phase,
    stats: liveById ? { filled, total, ratio: total > 0 ? Math.min(100, Math.round((filled / total) * 100)) : 0 } : null,
    days: dayModels,
  };
}
