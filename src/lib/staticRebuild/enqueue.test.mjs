import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  indexUniqueStaticRebuildTargetRows,
} from "./queueBatchCore.ts";

const source = await readFile(new URL("./enqueue.ts", import.meta.url), "utf8");

test("通常 enqueue は active row のCASと同時insert競合を有限回だけ再試行する", () => {
  assert.match(source, /ENQUEUE_CONFLICT_RETRY_LIMIT = 3/);
  assert.match(source, /result\.meta\?\.changes/);
  assert.match(source, /\.onConflictDoNothing\(\)/);
  assert.match(source, /insertResult\.meta\?\.changes/);
  assert.match(source, /static rebuild queue changed during enqueue retries/);
  assert.match(source, /eq\(staticRebuildQueue\.updated_at, row\.updated_at\)/g);
});

test("bulk queue prefetchは正常な最大16 targetを一意にindex化する", () => {
  assert.equal(
    source.match(/\.limit\(MAX_STATIC_REBUILD_BATCH_TARGETS \+ 1\)/g)?.length,
    2,
  );
  assert.match(source, /label:\s*"active"/);
  assert.match(source, /label:\s*"latest"/);
  const rows = Array.from({ length: 16 }, (_, index) => ({
    target_type: "event",
    target_id: `event-${index}`,
  }));
  const indexed = indexUniqueStaticRebuildTargetRows(rows, {
    maxRows: 16,
    label: "active",
  });
  assert.equal(indexed.size, 16);
});

test("bulk queue prefetchは返却超過をfail-closedにする", () => {
  const rows = Array.from({ length: 17 }, (_, index) => ({
    target_type: "event",
    target_id: `event-${index}`,
  }));
  assert.throws(
    () => indexUniqueStaticRebuildTargetRows(rows, {
      maxRows: 16,
      label: "latest",
    }),
    /static_rebuild_latest_rows_exceeded/,
  );
});

test("bulk queue prefetchはactive重複とlatest tieを曖昧に選ばない", () => {
  const duplicate = [
    { target_type: "event", target_id: "event-1" },
    { target_type: "event", target_id: "event-1" },
  ];
  assert.throws(
    () => indexUniqueStaticRebuildTargetRows(duplicate, {
      maxRows: 16,
      label: "active",
    }),
    /static_rebuild_active_target_ambiguous/,
  );
  assert.throws(
    () => indexUniqueStaticRebuildTargetRows(duplicate, {
      maxRows: 16,
      label: "latest",
    }),
    /static_rebuild_latest_target_ambiguous/,
  );
});
