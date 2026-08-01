#!/usr/bin/env node

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildReferenceCheckSql,
  classifyIconKey,
  collectReferencedKeys,
  computeOrphanGroups,
  escapeSqlLiteral,
  extractKeyFromMediaUrl,
  isSafeIconKey,
  parseArgs,
  parseKeysFile,
  parseR2ListOutput,
  runIconOrphanCleanup,
  sumBytes,
  toMediaUrl,
} from "./icon-orphan-cleanup.mjs";

test("isSafeIconKey rejects unsafe keys", () => {
  assert.equal(isSafeIconKey("xicons/alice/icon.webp"), true);
  assert.equal(isSafeIconKey("video-icons/alice/icon.webp"), true);
  assert.equal(isSafeIconKey("xicons/../secret"), false);
  assert.equal(isSafeIconKey("xicons\\evil"), false);
  assert.equal(isSafeIconKey("xicons/\u0001evil"), false);
  assert.equal(isSafeIconKey("https://example.com/x.png"), false);
});

test("classifyIconKey separates formal, staging, and rejected", () => {
  assert.equal(classifyIconKey("xicons/alice/a.webp"), "formal-xicons");
  assert.equal(classifyIconKey("video-icons/alice/a.webp"), "video-icons");
  assert.equal(classifyIconKey("xicons/staging/u1/a.webp"), "excluded-staging");
  assert.equal(classifyIconKey("xicons/staging/u1/a.webp", true), "staging");
  assert.equal(classifyIconKey("event-icons/a.webp"), "rejected");
});

test("extractKeyFromMediaUrl accepts only /api/media keys", () => {
  assert.equal(
    extractKeyFromMediaUrl("/api/media/xicons/alice/abc.webp"),
    "xicons/alice/abc.webp",
  );
  assert.equal(extractKeyFromMediaUrl("https://cdn.example/x.png"), null);
  assert.equal(extractKeyFromMediaUrl("/api/media/../secret"), null);
});

test("collectReferencedKeys merges urls and object keys", () => {
  const referenced = collectReferencedKeys([
    { value: "/api/media/xicons/alice/a.webp", kind: "url" },
    { value: "video-icons/bob/b.webp", kind: "key" },
    { value: "https://example.com/icon.png", kind: "url" },
  ]);
  assert.deepEqual([...referenced].sort(), [
    "video-icons/bob/b.webp",
    "xicons/alice/a.webp",
  ]);
});

test("computeOrphanGroups excludes referenced and reports staging separately", () => {
  const referenced = new Set(["xicons/alice/keep.webp"]);
  const groups = computeOrphanGroups(
    [
      { key: "xicons/alice/keep.webp", size: 10 },
      { key: "xicons/alice/orphan.webp", size: 20 },
      { key: "xicons/staging/u1/old.webp", size: 30 },
      { key: "video-icons/alice/orphan.webp", size: 40 },
      { key: "event-icons/ignore.webp", size: 50 },
    ],
    referenced,
  );

  assert.deepEqual(
    groups["formal-xicons"].map((entry) => entry.key),
    ["xicons/alice/orphan.webp"],
  );
  assert.deepEqual(groups["video-icons"].map((entry) => entry.key), [
    "video-icons/alice/orphan.webp",
  ]);
  assert.deepEqual(groups.staging.map((entry) => entry.key), ["xicons/staging/u1/old.webp"]);
});

test("computeOrphanGroups lists staging orphans for display", () => {
  const groups = computeOrphanGroups(
    [{ key: "xicons/staging/u1/old.webp", size: 1 }],
    new Set(),
  );
  assert.deepEqual(groups.staging.map((entry) => entry.key), ["xicons/staging/u1/old.webp"]);
});

test("parseKeysFile ignores blank lines and comments", () => {
  assert.deepEqual(parseKeysFile("# header\n\nxicons/a.webp\n\n"), ["xicons/a.webp"]);
});

test("parseR2ListOutput supports json and plain text", () => {
  assert.deepEqual(parseR2ListOutput('[{"key":"xicons/a.webp","size":123}]'), [
    { key: "xicons/a.webp", size: 123 },
  ]);
  assert.deepEqual(parseR2ListOutput("xicons/a.webp 123\n"), [{ key: "xicons/a.webp", size: 123 }]);
});

test("buildReferenceCheckSql escapes single quotes", () => {
  const sql = buildReferenceCheckSql("/api/media/xicons/o'b.webp", "xicons/o'b.webp");
  assert.match(sql, /o''b\.webp/);
  assert.doesNotMatch(sql, /\?1|\?2/);
});

test("escapeSqlLiteral doubles single quotes", () => {
  assert.equal(escapeSqlLiteral("o'b"), "o''b");
});

test("parseArgs defaults and validation", () => {
  const options = parseArgs([]);
  assert.equal(options.apply, false);
  assert.equal(options.remote, false);
  assert.equal(options.limit, 50);
  assert.equal(options.includeStaging, false);
  assert.throws(() => parseArgs(["--limit", "0"]), /positive integer/);
});

test("runIconOrphanCleanup dry-run does not delete", async () => {
  const deleted = [];
  const result = await runIconOrphanCleanup(
    {
      remote: false,
      apply: false,
      includeStaging: false,
      bucket: "flamenode-storage",
      keysFile: null,
      limit: 50,
    },
    {
      log: () => {},
      fetchReferencedKeys: () => new Set(),
      listR2Objects: () => ({
        entries: [{ key: "xicons/alice/orphan.webp", size: 100 }],
        source: "mock",
      }),
      deleteR2Object: (_bucket, key) => {
        deleted.push(key);
      },
    },
  );

  assert.deepEqual(deleted, []);
  assert.equal(result.skipped, 1);
});

test("runIconOrphanCleanup apply skips failed reference checks", async () => {
  const deleted = [];
  await runIconOrphanCleanup(
    {
      remote: false,
      apply: true,
      includeStaging: false,
      bucket: "flamenode-storage",
      keysFile: null,
      limit: 50,
    },
    {
      log: () => {},
      fetchReferencedKeys: () => new Set(),
      listR2Objects: () => ({
        entries: [{ key: "xicons/alice/orphan.webp", size: 100 }],
        source: "mock",
      }),
      deleteR2Object: (_bucket, key) => {
        deleted.push(key);
      },
      runD1: () => {
        throw new Error("d1 down");
      },
    },
  );

  assert.deepEqual(deleted, []);
});

test("runIconOrphanCleanup apply deletes only unreferenced keys", async () => {
  const deleted = [];
  await runIconOrphanCleanup(
    {
      remote: false,
      apply: true,
      includeStaging: false,
      bucket: "flamenode-storage",
      keysFile: null,
      limit: 50,
    },
    {
      log: () => {},
      fetchReferencedKeys: () => new Set(),
      listR2Objects: () => ({
        entries: [
          { key: "xicons/alice/orphan.webp", size: 100 },
          { key: "video-icons/alice/keep.webp", size: 200 },
        ],
        source: "mock",
      }),
      deleteR2Object: (_bucket, key) => {
        deleted.push(key);
      },
      runD1: (sql) => {
        if (sql.includes("video-icons/alice/keep.webp")) {
          return [{ results: [{ referenced: 1 }] }];
        }
        return [{ results: [] }];
      },
    },
  );

  assert.deepEqual(deleted, ["xicons/alice/orphan.webp"]);
});

test("toMediaUrl and sumBytes helpers", () => {
  assert.equal(toMediaUrl("xicons/a.webp"), "/api/media/xicons/a.webp");
  assert.equal(sumBytes([{ size: 10 }, { size: null }, { size: 5 }]), 15);
});
