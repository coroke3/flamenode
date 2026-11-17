import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import {
  managedChapterRowsEqual,
  buildChapterAuditSummary,
} from "../src/video/memberChapterAudit.ts";

function row(overrides = {}) {
  return {
    id: "vm1:member:0",
    video_id: "video1",
    x_user_id: "alice",
    chapter_time: 62,
    chapter_label: "Intro",
    note: "note",
    visibility: "public",
    created_at: 100,
    updated_at: 100,
    ...overrides,
  };
}

test("MIG-0650 U03d-2b: member chapter diff ignores DB timestamps and input ordering", () => {
  const before = [
    row({ id: "id-z", chapter_time: 10 }),
    row({ id: "id-a", chapter_time: 20 }),
  ];
  const after = [
    row({ id: "id-a", chapter_time: 20, created_at: 1, updated_at: 1000 }),
    row({ id: "id-z", chapter_time: 10, created_at: 42, updated_at: 999 }),
  ];
  assert.equal(managedChapterRowsEqual(before, after), true);
  assert.equal(managedChapterRowsEqual(after, before), true);
  assert.equal(before[0].id, "id-z", "comparison must not mutate caller arrays");
});

test("MIG-0650 U03d-2b: seven public chapter columns all trigger a change", () => {
  const previous = [row()];
  const changes = [
    { id: "other" },
    { video_id: "other-video" },
    { x_user_id: "bob" },
    { chapter_time: 62.1 },
    { chapter_label: "Changed" },
    { note: null },
    { visibility: "private" },
  ];
  for (const changed of changes) {
    assert.equal(managedChapterRowsEqual(previous, [row(changed)]), false, JSON.stringify(changed));
  }
  assert.equal(managedChapterRowsEqual([], previous), false);
  assert.equal(managedChapterRowsEqual(previous, []), false);
  assert.equal(managedChapterRowsEqual([], []), true);
});

test("MIG-0650 U03d-2b: SQLite binary ordering avoids locale comparison", () => {
  // The input order is different, but the same UTF-8 ID rows are equal.
  const a = [row({ id: "あ", chapter_time: 2 }), row({ id: "Z", chapter_time: 1 })];
  const b = [...a].reverse();
  assert.equal(managedChapterRowsEqual(a, b), true);
  assert.equal(managedChapterRowsEqual(a, b.map((x) => ({ ...x, updated_at: 999 }))), true);
  assert.equal(managedChapterRowsEqual(a, b.map((x) => x.id === "あ" ? { ...x, note: "changed" } : x)), false);
});

test("MIG-0650 U03d-2b: strict audit summary retains CURRENT fields and counts", () => {
  const rows = [
    row({ id: "a", x_user_id: "alice", chapter_time: 60, note: "a" }),
    row({ id: "b", x_user_id: "alice", chapter_time: 10, note: null }),
    row({ id: "c", x_user_id: "bob", chapter_time: 90, note: "" }),
    row({ id: "d", x_user_id: null, chapter_time: 20, note: "other" }),
  ];
  assert.deepEqual(buildChapterAuditSummary("video1", rows), {
    id: "video1",
    row_count: 4,
    member_count: 2,
    min_time: 10,
    max_time: 90,
    note_count: 2,
  });
  assert.deepEqual(buildChapterAuditSummary("video1", []), {
    id: "video1",
    row_count: 0,
    member_count: 0,
    min_time: null,
    max_time: null,
    note_count: 0,
  });
});

test("MIG-0650 U03d-2b: migration retains one shared chapter logic provider", async () => {
  const source = await readFile(new URL("../src/video/replaceVideoMembers.ts", import.meta.url), "utf8");
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.exports["./video/memberChapterAudit"], "./src/video/memberChapterAudit.ts");
  assert.match(source, /from "\.\/memberChapterAudit\.ts"/);
  assert.doesNotMatch(source, /function managedChapterRowsEqual\s*\(/);
  assert.doesNotMatch(source, /function buildChapterAuditSummary\s*\(/);
});
