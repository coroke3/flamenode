import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chunkRowsByJsonByteSize,
  jsonUtf8ByteLength,
  VIDEO_CHAPTER_JSON_MAX_BYTES,
  VIDEO_CHAPTER_JSON_MAX_BINDS,
} from "../src/video/chapterJsonChunking.ts";

// Contract copied independently from CURRENT's observed byte and row ordering,
// rather than trusting the server-core implementation to validate itself.
function originalChunk(rows, limit) {
  const encoder = new TextEncoder();
  const byteLength = value => encoder.encode(JSON.stringify(value)).length;
  if (!Number.isInteger(limit) || limit < 256) throw new Error("video_chapter_json_chunk_limit_invalid");
  const chunks = [];
  let current = [];
  let currentBytes = 2;
  for (const row of rows) {
    const rowBytes = byteLength(row);
    const nextBytes = currentBytes + (current.length ? 1 : 0) + rowBytes;
    if (rowBytes + 2 > limit) throw new Error("video_chapter_json_row_too_large");
    if (current.length && nextBytes > limit) {
      chunks.push(current);
      current = [];
      currentBytes = 2;
    }
    current.push(row);
    currentBytes += (current.length > 1 ? 1 : 0) + rowBytes;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

test("MIG-0650 U03d-2a: D1 per-bind and SQL parameter budgets preserved", () => {
  assert.equal(VIDEO_CHAPTER_JSON_MAX_BYTES, 1_000_000);
  assert.equal(VIDEO_CHAPTER_JSON_MAX_BINDS, 90);
});

test("MIG-0650 U03d-2a: rejects invalid bounds and oversized indivisible row", () => {
  for (const limit of [0, 1, 255, -1, 256.5, NaN, Infinity]) {
    assert.throws(() => chunkRowsByJsonByteSize(["x"], limit), /video_chapter_json_chunk_limit_invalid/);
  }
  assert.throws(
    () => chunkRowsByJsonByteSize(["x".repeat(500)], 256),
    /video_chapter_json_row_too_large/,
  );
});

test("MIG-0650 U03d-2a: byte-accurate UTF-8, escaped text and boundary equality", () => {
  assert.equal(jsonUtf8ByteLength("あ"), 5);
  assert.equal(jsonUtf8ByteLength('"\\'), 6);
  assert.equal(jsonUtf8ByteLength({ note: "日本語\n🗻" }),
    new TextEncoder().encode(JSON.stringify({ note: "日本語\n🗻" })).length);
  const exact = "x".repeat(254); // JSON string bytes = 256 including quotes; + [] => 258.
  assert.deepEqual(chunkRowsByJsonByteSize([exact], 258), [[exact]]);
  assert.throws(() => chunkRowsByJsonByteSize([exact], 257), /video_chapter_json_row_too_large/);
});

test("MIG-0650 U03d-2a: original CURRENT algorithm and shared provider agree on all chunking cases", () => {
  const cases = [
    [],
    [1],
    ["日本語", "🙂", "a\n\\\"b"],
    Array.from({ length: 150 }, (_, i) => ({ id: "chapter-" + i, note: "映像🗻".repeat(i % 21) })),
    Array.from({ length: 30 }, (_, i) => ({ id: i, note: "k".repeat(i % 7 ? 90 : 130) })),
  ];
  for (const limit of [256, 300, 350, 1024, 10000, VIDEO_CHAPTER_JSON_MAX_BYTES]) {
    for (const rows of cases) {
      let expected;
      try {
        expected = originalChunk(rows, limit);
      } catch (error) {
        assert.throws(() => chunkRowsByJsonByteSize(rows, limit), { message: error.message });
        continue;
      }
      const actual = chunkRowsByJsonByteSize(rows, limit);
      assert.deepEqual(actual, expected);
      assert.deepEqual(actual.flat(), rows, "no row lost, reordered or duplicated");
      for (const chunk of actual) {
        assert.ok(jsonUtf8ByteLength(chunk) <= limit, "each SQL JSON1 bind must fit");
      }
    }
  }
});

test("MIG-0650 U03d-2a: legacy Next source remains a compatibility re-export, not another algorithm", async () => {
  const { readFile } = await import("node:fs/promises");
  const oldFile = await readFile(new URL("../../../src/lib/video/replaceVideoMembers.ts", import.meta.url), "utf8");
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.exports["./video/chapterJsonChunking"], "./src/video/chapterJsonChunking.ts");
  assert.match(oldFile, /from "@flamenode\/server-core\/video\/chapterJsonChunking"/);
  assert.match(oldFile, /export \{[\s\S]*VIDEO_CHAPTER_JSON_MAX_BYTES[\s\S]*\} from "@flamenode\/server-core\/video\/chapterJsonChunking"/);
  assert.doesNotMatch(oldFile, /const JSON_ENCODER = new TextEncoder/);
  assert.doesNotMatch(oldFile, /export function chunkRowsByJsonByteSize/);
});
