import { formatUnix } from "@/lib/utils/format";
import {
  buildSlotParts,
  collapseReservationGroups,
  sortSlotsChronologically,
  type SlotBase,
  type SlotGroupRow,
  type SlotPart,
} from "./slotGroupingCore";

export type { SlotBase, SlotGroupRow, SlotPart };
export { buildSlotParts, collapseReservationGroups, sortSlotsChronologically };

export function formatSlotPartLabel(
  part: SlotPart<{ start_time: number | null }>,
  mode: "full" | "short" = "full",
): string {
  if (part.is_timeless) return "時間なし枠";
  const base = `第${part.index}部`;
  if (mode === "short" || !part.start_time) return base;
  const end = part.last_start_time;
  const date = formatUnix(part.start_time, { dateOnly: true });
  const start = formatUnix(part.start_time, { timeOnly: true });
  const range =
    end != null && end > part.start_time
      ? `${start} - ${formatUnix(end, { timeOnly: true })}`
      : start;
  return `${date}  ${base}  ${range}`;
}
