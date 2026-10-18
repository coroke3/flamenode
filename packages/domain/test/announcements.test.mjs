import assert from "node:assert/strict";
import test from "node:test";
import {
  announcementInputSchema,
  parseAnnouncementDates,
  validateAnnouncementInput,
} from "@flamenode/domain/announcements";

test("announcementInputSchema validates required fields and default values", () => {
  const result = announcementInputSchema.safeParse({
    title: "お知らせタイトル",
    body: "お知らせ本文です。",
  });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.title, "お知らせタイトル");
  assert.equal(result.data.severity, "info");
  assert.equal(result.data.target_audience, "all");
  assert.equal(result.data.is_published, 0);
});

test("announcementInputSchema rejects empty title or body", () => {
  const badTitle = announcementInputSchema.safeParse({
    title: "   ",
    body: "本文",
  });
  assert.equal(badTitle.success, false);

  const badBody = announcementInputSchema.safeParse({
    title: "タイトル",
    body: "   ",
  });
  assert.equal(badBody.success, false);
});

test("parseAnnouncementDates handles valid JST datetime range", () => {
  const res = parseAnnouncementDates(
    "2026-10-17T10:00",
    "2026-10-17T18:00",
  );
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.ok(res.publishAt != null);
  assert.ok(res.expireAt != null);
  assert.ok(res.expireAt > res.publishAt);
});

test("parseAnnouncementDates rejects inverted datetime range", () => {
  const res = parseAnnouncementDates(
    "2026-10-17T18:00",
    "2026-10-17T10:00",
  );
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(
    res.message,
    "掲載終了日時は掲載開始日時より後にしてください。",
  );
});

test("parseAnnouncementDates rejects malformed dates", () => {
  const res = parseAnnouncementDates("not-a-date", null);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.message, "掲載日時の形式が正しくありません。");
});

test("validateAnnouncementInput parses form object and returns clean data and dates", () => {
  const res = validateAnnouncementInput({
    title: "Test Announcement",
    body: "Test Body",
    severity: "warning",
    target_audience: "creators",
    is_published: "1",
    publish_at: "2026-10-17T10:00",
    expire_at: "2026-10-18T10:00",
  });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.data.is_published, 1);
  assert.equal(res.data.severity, "warning");
  assert.equal(res.data.target_audience, "creators");
  assert.ok(res.dates.expireAt > res.dates.publishAt);
});
