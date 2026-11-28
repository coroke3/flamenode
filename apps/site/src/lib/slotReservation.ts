/** MIG-0514 U02 provisional client (D-16-1).
 * Replace this response check with the `@flamenode/contracts` schema when MIG-0657 is merged.
 * CURRENT SA-065..068 remains canonical; this module does not enable reservation UI.
 */

import { getGuardRedirectPath } from "./guardRedirect.ts";

export interface SlotReservationResult {
  ok: boolean;
  message?: string;
  reason?: string;
  slotId?: string;
  slotCount?: number;
  groupSize?: number;
  pendingPublicReflection?: boolean;
}

/** Transport metadata stays outside the provisional server DTO (never trust a body status). */
export interface SlotReservationResponse {
  readonly status: number;
  readonly result: SlotReservationResult;
}

export interface ReserveSlotInput {
  display_name: string;
  consecutive_count: number;
  operator_override?: boolean;
}

export interface ExtendSlotInput {
  direction: "forward" | "backward";
  operator_override?: boolean;
}

export interface MergeSlotGroupInput {
  gap_slot_id: string;
  display_name: string;
  operator_override?: boolean;
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
): Promise<SlotReservationResponse> {
  const response = await fetcher(path, {
    method: "POST",
    // A mutation endpoint must not redirect/replay its POST to another URL.
    redirect: "error",
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
  return { status: response.status, result };
}

const slotPath = (eventId: string, slotId: string) =>
  `/api/events/${encodeURIComponent(eventId)}/slots/${encodeURIComponent(slotId)}`;

export function reserveSlot(
  eventId: string,
  slotId: string,
  input: ReserveSlotInput,
  fetcher: typeof fetch = fetch,
): Promise<SlotReservationResponse> {
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
): Promise<SlotReservationResponse> {
  return post(`${slotPath(eventId, slotId)}/release`, undefined, fetcher);
}

export function extendSlot(
  eventId: string,
  slotId: string,
  input: ExtendSlotInput,
  fetcher: typeof fetch = fetch,
): Promise<SlotReservationResponse> {
  return post(`${slotPath(eventId, slotId)}/extend`, {
    direction: input.direction,
    ...(input.operator_override === undefined ? {} : { operator_override: input.operator_override }),
  }, fetcher);
}

export function mergeSlotGroup(
  eventId: string,
  input: MergeSlotGroupInput,
  fetcher: typeof fetch = fetch,
): Promise<SlotReservationResponse> {
  return post(`/api/events/${encodeURIComponent(eventId)}/slot-groups/merge`, {
    gap_slot_id: input.gap_slot_id,
    display_name: input.display_name,
    ...(input.operator_override === undefined ? {} : { operator_override: input.operator_override }),
  }, fetcher);
}

/** U03 presentation only; do not mount mutation controls before the U04 schema gate. */
export type SlotMutationPresentation =
  | { operation: "reserve"; requestedCount: number; canPost: boolean }
  | { operation: "release" }
  | { operation: "extend" | "merge"; canPost: boolean };

export type SlotMutationFeedback =
  | { kind: "success"; message: string; pendingPublicReflection: boolean | undefined }
  | { kind: "failure"; message: string; reason: string | undefined };

const failureMessages = {
  reserve: "枠の確保に失敗しました。",
  release: "枠の解放に失敗しました。",
  extend: "枠の拡張に失敗しました。",
  merge: "枠の結合に失敗しました。",
} as const;

/** CURRENT SlotGrid result text. Navigation, refresh and authorization stay with the host. */
export function describeSlotMutationResult(
  presentation: SlotMutationPresentation,
  result: SlotReservationResult,
): SlotMutationFeedback {
  if (!result.ok) {
    return {
      kind: "failure",
      message: result.message ?? failureMessages[presentation.operation],
      reason: result.reason,
    };
  }
  let message: string;
  switch (presentation.operation) {
    case "reserve": {
      const count = result.slotCount ?? result.groupSize ?? presentation.requestedCount;
      message = count > 1
        ? `${count}枠連続で確保しました。`
        : presentation.canPost
          ? "枠を確保しました。続けて作品情報を登録できます。"
          : "枠を確保しました。作品投稿には X ID の承認が必要です。";
      break;
    }
    case "release":
      message = "枠を解放しました。";
      break;
    case "extend": {
      const count = result.groupSize ?? 0;
      message = count > 1
        ? `連続${count}枠になりました。`
        : presentation.canPost
          ? "枠を拡張しました。続けて作品情報を登録できます。"
          : "枠を拡張しました。作品投稿には X ID の承認が必要です。";
      break;
    }
    case "merge": {
      const count = result.groupSize ?? 0;
      message = count > 1
        ? `${count}枠を1つの連続枠にまとめました。`
        : presentation.canPost
          ? "枠を結合しました。続けて作品情報を登録できます。"
          : "枠を結合しました。作品投稿には X ID の承認が必要です。";
      break;
    }
  }
  return { kind: "success", message, pendingPublicReflection: result.pendingPublicReflection };
}


/** U03g: unmounted mutation outcome; U04 must validate the canonical DTO first. */
export type SlotMutationOutcome =
  | (Extract<SlotMutationFeedback, { kind: "success" }> & { refresh: true; slotId: string | undefined })
  | (Extract<SlotMutationFeedback, { kind: "failure" }> & { refresh: boolean })
  | { kind: "redirect"; path: string; refresh: false }
  | { kind: "communication-error"; message: string; refresh: true };

const COMMUNICATION_ERROR_MESSAGE =
  "通信エラーが発生しました。状態を再取得してもう一度お試しください。";

/**
 * CURRENT SlotGrid settlement policy, with navigation and refresh delegated
 * to the host. No retry: a transport failure may follow a committed write.
 * The host must scope the outcome to the still-current event/viewer before
 * acting on it and re-read both RH-014 and RH-020 when refresh is true.
 */
export async function runSlotMutation(
  presentation: SlotMutationPresentation,
  mutate: () => Promise<SlotReservationResponse>,
  getCurrentPath: () => string | null | undefined,
): Promise<SlotMutationOutcome> {
  let response: SlotReservationResponse;
  try {
    response = await mutate();
  } catch {
    // TARGET uses HTTP, not Next control-flow exceptions.
    return { kind: "communication-error", message: COMMUNICATION_ERROR_MESSAGE, refresh: true };
  }
  const { status, result } = response;
  if (!result.ok) {
    const path = getGuardRedirectPath(result.reason, getCurrentPath());
    if (path) return { kind: "redirect", path, refresh: false };
  }
  const feedback = describeSlotMutationResult(presentation, result);
  if (feedback.kind === "success") {
    return { ...feedback, slotId: result.slotId, refresh: true };
  }
  // T02: an actual HTTP 409 typed denial requests authoritative read-only
  // refresh; never infer conflict from DTO fields or retry the mutation.
  // Guard redirects above retain precedence; other typed denials are unchanged.
  return { ...feedback, refresh: status === 409 };
}
