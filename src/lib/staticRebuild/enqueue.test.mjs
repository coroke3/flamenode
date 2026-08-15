import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  indexUniqueStaticRebuildTargetRows,
} from "./queueBatchCore.ts";
import { D1_MAX_BIND_PARAMETERS } from "../audit/mutateBudget.ts";

const source = await readFile(new URL("./enqueue.ts", import.meta.url), "utf8");

test("通常 enqueue は active row のCASと同時insert競合を有限回だけ再試行する", () => {
  assert.match(source, /ENQUEUE_CONFLICT_RETRY_LIMIT = 3/);
  assert.match(source, /result\.meta\?\.changes/);
  assert.match(source, /\.onConflictDoNothing\(\)/);
  assert.match(source, /insertResult\.meta\?\.changes/);
  assert.match(source, /static rebuild queue changed during enqueue retries/);
  assert.match(source, /eq\(staticRebuildQueue\.updated_at, row\.updated_at\)/g);
});

test("bulk queue builderはprefetchなしのjson_each UPSERTを使う", () => {
  const batchFn = source.slice(
    source.indexOf("export async function buildStaticRebuildQueueBatch"),
    source.indexOf("export async function enqueueStaticRebuild"),
  );
  assert.match(source, /STATIC_REBUILD_BATCH_PREFETCH_QUERY_COUNT = 0/);
  assert.match(source, /STATIC_REBUILD_BULK_UPSERT_ROWS = 50/);
  assert.doesNotMatch(batchFn, /\.select\(staticRebuildActiveLookupSelect\)/);
  assert.doesNotMatch(batchFn, /indexUniqueStaticRebuildTargetRows/);
  assert.match(batchFn, /FROM json_each\(\$\{payload\}\)/);
  assert.match(
    batchFn,
    /ON CONFLICT\(target_type, target_id\) WHERE status IN \('pending', 'processing'\)/,
  );
  assert.match(batchFn, /updated_at = MAX\(static_rebuild_queue\.updated_at \+ 1, excluded\.updated_at\)/);
  assert.doesNotMatch(batchFn, /eq\(staticRebuildQueue\.status, item\.row\.status\)/);
});

test("queueBatchCoreはactive重複をfail-closedにする", () => {
  const rows = Array.from({ length: 16 }, (_, index) => ({
    target_type: "event",
    target_id: `event-${index}`,
  }));
  const indexed = indexUniqueStaticRebuildTargetRows(rows, {
    maxRows: 16,
    label: "active",
  });
  assert.equal(indexed.size, 16);

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

test("16 target UPSERTはchunk 10以下でbind上限内", async () => {
  if (process.env.FLAMENODE_TSX_TEST_ENTRY) {
    const { registerHooks } = await import("node:module");
    registerHooks({
      resolve(specifier, context, nextResolve) {
        if (specifier === "server-only") {
          return {
            url: "data:text/javascript,export%20{}",
            shortCircuit: true,
          };
        }
        return nextResolve(specifier, context);
      },
    });
    const { drizzle } = await import("drizzle-orm/sqlite-proxy");
    const { buildStaticRebuildQueueBatch } = await import("./enqueue.ts");
    const db = drizzle(async () => ({ rows: [] }));
    const items = Array.from({ length: 16 }, (_, index) => ({
      targetType: "event",
      targetId: `event-${index}`,
      reason: "test_enqueue",
    }));
    const batch = await buildStaticRebuildQueueBatch(db, items);
    assert.equal(batch.statements.length, 1);
    assert.deepEqual(batch.expectedChanges, [16]);
    for (const statement of batch.statements) {
      const query =
        typeof statement.getQuery === "function"
          ? statement.getQuery()
          : statement.toSQL();
      assert.ok(
        query.params.length <= D1_MAX_BIND_PARAMETERS,
        `bind count ${query.params.length} exceeds ${D1_MAX_BIND_PARAMETERS}`,
      );
    }
    return;
  }

  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const entryPath = fileURLToPath(import.meta.url);
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", entryPath],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        FLAMENODE_TSX_TEST_ENTRY: entryPath,
        NODE_TEST_CONTEXT: undefined,
      },
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
});
