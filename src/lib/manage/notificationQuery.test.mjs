import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readManageNotificationQueryValue, readManageNotificationStatusFilter } from "./notificationQuery.ts";

test("manage notifications query parser preserves normal scalar filters", () => {
  assert.equal(readManageNotificationQueryValue("  failed  "), "  failed  ");
  assert.equal(readManageNotificationQueryValue(" event-1 "), " event-1 ");
  assert.equal(readManageNotificationQueryValue(" video "), " video ", "notif filter must retain its original exact-match policy");
  assert.equal(readManageNotificationQueryValue("video"), "video");
  assert.equal(readManageNotificationQueryValue(""), "");
});

test("manage notifications query parser ignores duplicate and malformed values", () => {
  // ?event=a&event=b, ?notif=video&notif=slot, and ?status=failed&status=sent
  // are delivered as arrays by Next.js. None may crash or select an event.
  for (const value of [
    ["event-1", "event-2"], ["video", "slot"], ["failed", "sent"],
    [], ["failed"], null, undefined, 42, {}, true,
  ]) {
    assert.equal(readManageNotificationQueryValue(value), "", String(value));
  }
});

test("manage notification status filter keeps only supported states", () => {
  for (const state of ["failed", "pending", "processing", "sent", "cancelled"]) {
    assert.equal(readManageNotificationStatusFilter(state), state);
    assert.equal(readManageNotificationStatusFilter("  " + state + "  "), state);
  }
  for (const raw of ["", "all", "not-a-status", ["sent", "failed"], ["sent"], null, undefined, 42]) {
    assert.equal(readManageNotificationStatusFilter(raw), "", String(raw));
  }
});

test("CURRENT manage notifications page normalizes all three query keys", () => {
  const source = readFileSync(new URL("../../../app/(manage)/manage/notifications/page.tsx", import.meta.url), "utf8");
  for (const key of ["event", "notif", "status"]) {
    assert.ok(source.includes(`${key}?: string | string[];`), key + " Next.js input type");
    const invocation = key === "status" ? "readManageNotificationStatusFilter(sp.status)" : `readManageNotificationQueryValue(sp.${key})`;
    assert.ok(source.includes(invocation), key + " normalized before use");
  }
  assert.ok(source.includes('import { readManageNotificationQueryValue, readManageNotificationStatusFilter } from "@/lib/manage/notificationQuery";'));
  assert.ok(source.includes("readManageNotificationQueryValue(sp.event).trim()"));
  assert.ok(source.includes("readManageNotificationStatusFilter(sp.status)"));
  assert.ok(source.includes("const notificationType = readManageNotificationQueryValue(sp.notif);"));
  assert.ok(!source.includes('(sp.event ?? "").trim()'));
  assert.ok(!source.includes('(sp.status ?? "").trim()'));
});
