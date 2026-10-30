/** MIG-0514 U02 provisional client (D-16-1).
 * Replace this response check with the `@flamenode/contracts` schema when MIG-0657 is merged.
 * CURRENT SA-065..068 remains canonical; this module does not enable reservation UI.
 */

export interface SlotReservationResult {
  ok: boolean;
  message?: string;
  reason?: string;
  slotId?: string;
  slotCount?: number;
  groupSize?: number;
  pendingPublicReflection?: boolean;
}

export interface ReserveSlotInput {
  display_name: string;
  consecutive_count: number;
  operator_override?: boolean;
}

export interface ExtendSlotInput {
  direction: "forward" | "backward";
}

export interface MergeSlotGroupInput {
  gap_slot_id: string;
  display_name: string;
}

function parseResult(value: unknown): SlotReservationResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Invalid slot reservation response");
  }
  const result = value as Record<string, unknown>;
  if (typeof result.ok !== "boolean") {
    throw new TypeError("Invalid slot reservation response: missing ok");
  }
  return value as SlotReservationResult;
}

async function post(
  path: string,
  body: Record<string, unknown> | undefined,
  fetcher: typeof fetch,
): Promise<SlotReservationResult> {
  const response = await fetcher(path, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = parseResult(await response.json());
  // A 409 guard/concurrent reservation returns {ok:false, message}; preserve it
  // for the CURRENT SlotGrid's error/redirect handling instead of throwing.
  if (!response.ok && result.ok) {
    throw new TypeError("Invalid slot reservation response: success on error status");
  }
  return result;
}

const slotPath = (eventId: string, slotId: string) =>
  `/api/events/${encodeURIComponent(eventId)}/slots/${encodeURIComponent(slotId)}`;

export function reserveSlot(
  eventId: string,
  slotId: string,
  input: ReserveSlotInput,
  fetcher: typeof fetch = fetch,
): Promise<SlotReservationResult> {
  return post(`${slotPath(eventId, slotId)}/reserve`, {
    display_name: input.display_name,
    consecutive_count: input.consecutive_count,
    ...(input.operator_override === undefined ? {} : { operator_override: input.operator_override }),
  }, fetcher);
}

export function releaseSlot(
  eventId: string,
  slotId: string,
  fetcher: typeof fetch = fetch,
): Promise<SlotReservationResult> {
  return post(`${slotPath(eventId, slotId)}/release`, undefined, fetcher);
}

export function extendSlot(
  eventId: string,
  slotId: string,
  input: ExtendSlotInput,
  fetcher: typeof fetch = fetch,
): Promise<SlotReservationResult> {
  return post(`${slotPath(eventId, slotId)}/extend`, { direction: input.direction }, fetcher);
}

export function mergeSlotGroup(
  eventId: string,
  input: MergeSlotGroupInput,
  fetcher: typeof fetch = fetch,
): Promise<SlotReservationResult> {
  return post(`/api/events/${encodeURIComponent(eventId)}/slot-groups/merge`, {
    gap_slot_id: input.gap_slot_id,
    display_name: input.display_name,
  }, fetcher);
}
