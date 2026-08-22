import { formatUnix } from "@/lib/utils/format";
import {
  annotateReservationGroups,
  buildSlotParts,
  collapseReservationGroups,
  sortSlotsChronologically,
  type SlotAnnotatedRow,
  type SlotBase,
  type SlotGroupRow,
  type SlotPart,
} from "./slotGroupingCore";

export type { SlotAnnotatedRow, SlotBase, SlotGroupRow, SlotPart };
export {
  annotateReservationGroups,
  buildSlotParts,
  collapseReservationGroups,
  sortSlotsChronologically,
};

export function resolveSlotPartDisplayLabel(
  index: number,
  configuredParts?: readonly string[] | null,
): string {
  return configuredParts?.[index - 1]?.trim() || `第${index}部`;
}

export function formatSlotPartLabel(
  part: SlotPart<{ start_time: number | null }>,
  mode: "full" | "short" = "full",
  configuredParts?: readonly string[] | null,
): string {
  if (part.is_timeless) return "時間なし枠";
  const base = resolveSlotPartDisplayLabel(part.index, configuredParts);
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
