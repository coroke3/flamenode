import { test } from "node:test";
import assert from "node:assert/strict";

import {
  formatAuditValue,
  isImportantAuditKey,
  labelAuditKey,
  parseAuditDiff,
} from "./diff.ts";

test("parseAuditDiff handles CREATE", () => {
  const diff = parseAuditDiff(null, JSON.stringify({ title: "新規", status: "public" }));
  assert.equal(diff.changes.length, 2);
  assert.ok(diff.changes.every((c) => c.kind === "added"));
});

test("parseAuditDiff handles UPDATE changes only", () => {
  const diff = parseAuditDiff(
    JSON.stringify({ title: "旧", music: "same" }),
    JSON.stringify({ title: "新", music: "same" }),
  );
  assert.deepEqual(diff.changedKeys, ["title"]);
  assert.equal(diff.changes[0]?.label, "作品タイトル");
  assert.equal(diff.changes[0]?.beforeText, "旧");
  assert.equal(diff.changes[0]?.afterText, "新");
});

test("parseAuditDiff handles DELETE", () => {
  const diff = parseAuditDiff(JSON.stringify({ title: "削除" }), null);
  assert.equal(diff.changes[0]?.kind, "removed");
});

test("parseAuditDiff handles JSON parse failure", () => {
  const diff = parseAuditDiff("{broken", JSON.stringify({ title: "ok" }));
  assert.equal(diff.beforeParsed, false);
  assert.equal(diff.changes.length, 0);
  assert.equal(diff.beforePretty, "{broken");
});

test("parseAuditDiff classifies added and removed values", () => {
  const diff = parseAuditDiff(
    JSON.stringify({ title: "旧", credit: "消える" }),
    JSON.stringify({ title: "旧", music: "増える" }),
  );
  assert.equal(diff.changes.find((c) => c.key === "music")?.kind, "added");
  assert.equal(diff.changes.find((c) => c.key === "credit")?.kind, "removed");
});

test("formatAuditValue truncates long text and distinguishes null / empty", () => {
  assert.equal(formatAuditValue(null), "(null)");
  assert.equal(formatAuditValue(""), "(空文字)");
  assert.equal(formatAuditValue("a".repeat(200), 10), "aaaaaaaaaa…");
});

test("important key and labels are detected", () => {
  assert.equal(labelAuditKey("youtube_video_id"), "YouTube ID");
  assert.equal(isImportantAuditKey("youtube_video_id"), true);
  assert.equal(isImportantAuditKey("custom_answers"), false);
});
