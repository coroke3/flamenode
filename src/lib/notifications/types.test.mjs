import test from "node:test";
import assert from "node:assert/strict";
import {
  categorizeNotificationType,
  getNotificationSeverity,
  getNotificationTypeLabel,
} from "./types.ts";

test("categorizeNotificationType", () => {
  assert.equal(categorizeNotificationType("video_approved"), "video");
  assert.equal(categorizeNotificationType("slot_deadline_reminder"), "slot");
  assert.equal(categorizeNotificationType("x_id_approved"), "x_id");
  assert.equal(categorizeNotificationType("chapter_comment_added"), "chapter");
  assert.equal(categorizeNotificationType("moderation_created"), "moderation");
  assert.equal(categorizeNotificationType("announcement_broadcast"), "announcement");
  assert.equal(categorizeNotificationType("discord_webhook"), "system");
  assert.equal(categorizeNotificationType("welcome_account"), "system");
  assert.equal(categorizeNotificationType("custom_foo"), "unknown");
});

test("getNotificationTypeLabel", () => {
  assert.equal(getNotificationTypeLabel("video_approved"), "作品が公開されました");
  assert.equal(getNotificationTypeLabel("welcome_account"), "アカウント作成のお知らせ");
  assert.equal(getNotificationTypeLabel("unknown_type"), "unknown type");
});

test("getNotificationSeverity", () => {
  assert.equal(getNotificationSeverity("video_voided"), "critical");
  assert.equal(getNotificationSeverity("video_submitted"), "info");
  assert.equal(getNotificationSeverity("welcome_account"), "info");
  assert.equal(getNotificationSeverity("slot_submission_released"), "warning");
});

test("slot submission released is a slot notification", () => {
  assert.equal(categorizeNotificationType("slot_submission_released"), "slot");
  assert.equal(
    getNotificationTypeLabel("slot_submission_released"),
    "枠の作品提出が解除されました",
  );
});
