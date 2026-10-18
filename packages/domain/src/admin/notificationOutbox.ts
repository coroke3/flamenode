// Notification outbox status vocabulary (moved unchanged from src/lib/notifications/status.ts)
// and the admin retry/cancel transitions of SA-045..048 (from src/lib/actions/notification-admin.ts).
export const TERMINAL_NOTIFICATION_FAILURE_STATUSES = [
  "failed",
  "dead_letter",
] as const;

export type TerminalNotificationFailureStatus =
  (typeof TERMINAL_NOTIFICATION_FAILURE_STATUSES)[number];

export type NotificationOutboxStatus =
  | "pending"
  | "processing"
  | "sent"
  | TerminalNotificationFailureStatus
  | "cancelled";

export function isTerminalNotificationFailure(
  status: string | null | undefined,
): status is TerminalNotificationFailureStatus {
  return status === "failed" || status === "dead_letter";
}

/** Row patch that puts a terminal-failure notification back to pending. */
export function notificationRetryPatch(now: number) {
  return {
    status: "pending" as const,
    attempt_count: 0,
    processing_started_at: null,
    lease_token: null,
    lease_expires_at: null,
    next_attempt_at: now,
    last_error: null,
    processed_at: null,
  };
}

/** Row patch of a manual cancel. */
export function notificationCancelPatch(now: number, reason?: string) {
  return {
    status: "cancelled" as const,
    processing_started_at: null,
    lease_token: null,
    lease_expires_at: null,
    next_attempt_at: null,
    last_error: reason || "manual cancel",
    processed_at: now,
  };
}

export type NotificationCancelDecision =
  | { kind: "already_terminal"; message: string }
  | { kind: "in_flight"; message: string }
  | { kind: "cancel" };

/**
 * SA-046: cancelling sent/cancelled rows is an idempotent success. A
 * processing row can still be delivered by the dispatcher between lease claim
 * and the Discord request, so it is never reported as cancelled.
 */
export function decideNotificationCancel(status: string | null): NotificationCancelDecision {
  if (status === "sent" || status === "cancelled") {
    return { kind: "already_terminal", message: `既に${status}です。` };
  }
  if (status === "processing") {
    return {
      kind: "in_flight",
      message: "配送中の通知はキャンセルできません。配送完了後に再度お試しください。",
    };
  }
  return { kind: "cancel" };
}
