import test from "node:test";
import assert from "node:assert/strict";
import {
  categorizeNotificationType,
  getNotificationSeverity,
  getNotificationTypeLabel,
  manageFilterMatchesType,
} from "./types.ts";

test("categorizeNotificationType", () => {
  assert.equal(categorizeNotificationType("video_approved"), "video");
  assert.equal(categorizeNotificationType("slot_deadline_reminder"), "slot");
  assert.equal(categorizeNotificationType("x_id_approved"), "x_id");
  assert.equal(categorizeNotificationType("chapter_comment_added"), "chapter");
  assert.equal(categorizeNotificationType("moderation_created"), "moderation");
  assert.equal(categorizeNotificationType("announcement_broadcast"), "announcement");
  assert.equal(categorizeNotificationType("discord_webhook"), "system");
  assert.equal(categorizeNotificationType("custom_foo"), "unknown");
});

test("getNotificationTypeLabel", () => {
  assert.equal(getNotificationTypeLabel("video_approved"), "作品が公開されました");
  assert.equal(getNotificationTypeLabel("unknown_type"), "unknown type");
});

test("getNotificationSeverity", () => {
  assert.equal(getNotificationSeverity("video_voided"), "critical");
  assert.equal(getNotificationSeverity("video_submitted"), "info");
});

test("manageFilterMatchesType", () => {
  assert.equal(manageFilterMatchesType("video_approved", "video"), true);
  assert.equal(manageFilterMatchesType("announcement_broadcast", "video"), false);
  assert.equal(manageFilterMatchesType("announcement_broadcast", "other"), true);
});
