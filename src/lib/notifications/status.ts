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
