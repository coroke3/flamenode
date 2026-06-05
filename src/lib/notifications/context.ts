/**
 * レガシーインポート等でユーザー向け Discord 通知を抑止するためのリクエストスコープ。
 * Server Action / import 処理の入口で runWithNotificationBehavior を使う。
 */

export type NotificationBehavior = "none" | "user" | "admin_only";

const stack: NotificationBehavior[] = ["user"];

export function getNotificationBehavior(): NotificationBehavior {
  return stack[stack.length - 1] ?? "user";
}

export function shouldEnqueueUserNotification(): boolean {
  return getNotificationBehavior() === "user";
}

export async function runWithNotificationBehavior<T>(
  behavior: NotificationBehavior,
  fn: () => Promise<T>,
): Promise<T> {
  stack.push(behavior);
  try {
    return await fn();
  } finally {
    stack.pop();
  }
}

export function resolveNotificationBehaviorFromImportOptions(options: {
  sendNotifications?: boolean;
  notificationBehavior?: NotificationBehavior;
}): NotificationBehavior {
  if (options.notificationBehavior) return options.notificationBehavior;
  if (options.sendNotifications === true) return "user";
  return "none";
}
