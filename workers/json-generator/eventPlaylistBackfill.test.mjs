import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  ensureEventPlaylistBackfill,
  EVENT_PLAYLIST_BACKFILL_BATCH_SIZE,
  EVENT_PLAYLIST_BACKFILL_CURSOR_KEY,
  EVENT_PLAYLIST_BACKFILL_DONE_KEY,
} from "./eventPlaylistBackfill.ts";

const source = await readFile(new URL("./eventPlaylistBackfill.ts", import.meta.url), "utf8");

function fakeEnv(batches) {
  const kv = new Map();
  const queries = [];
  const writtenBatches = [];
  let queryCount = 0;
  const env = {
    queries,
    writtenBatches,
    DB: {
      prepare(sql) {
        const statement = {
          sql,
          bind(...args) {
            queries.push({ sql, args });
            return statement;
          },
          async all() {
            return { results: batches[Math.min(queryCount++, batches.length - 1)] ?? [] };
          },
        };
        return statement;
      },
      async batch(statements) {
        writtenBatches.push(statements);
        return statements.map(() => ({ meta: { changes: 1 } }));
      },
    },
    KV: {
      async get(key) {
        return kv.get(key) ?? null;
      },
      async put(key, value) {
        kv.set(key, value);
      },
    },
  };
  return { env, kv };
}

test("playlist backfill は public event を10件ずつ cursor enqueue する", async () => {
  const { env, kv } = fakeEnv([
    Array.from({ length: 10 }, (_, i) => ({ id: `event-${String(i).padStart(2, "0")}` })),
    [{ id: "event-10" }, { id: "event-11" }],
  ]);

  assert.equal(EVENT_PLAYLIST_BACKFILL_BATCH_SIZE, 10);
  assert.equal(await ensureEventPlaylistBackfill(env), 10);
  assert.equal(env.writtenBatches[0].length, 20);
  assert.match(env.queries[0].sql, /visibility_status = 'public'/);
  assert.match(env.queries[0].sql, /ORDER BY id ASC/);
  assert.equal(kv.get(EVENT_PLAYLIST_BACKFILL_CURSOR_KEY), "event-09");
  assert.equal(kv.get(EVENT_PLAYLIST_BACKFILL_DONE_KEY), undefined);
  assert.match(env.writtenBatches[0][0].sql, /WHEN priority = 'high' THEN reason/);
  assert.match(env.writtenBatches[0][1].sql, /'event_base'/);
  assert.doesNotMatch(env.writtenBatches[0][1].sql, /event_playlist/);

  assert.equal(await ensureEventPlaylistBackfill(env), 2);
  assert.equal(kv.get(EVENT_PLAYLIST_BACKFILL_CURSOR_KEY), "event-11");
  assert.equal(kv.get(EVENT_PLAYLIST_BACKFILL_DONE_KEY), "1");
});

test("playlist backfill は完了後にD1を再読しない", async () => {
  const { env, kv } = fakeEnv([[{ id: "event-1" }]]);
  kv.set(EVENT_PLAYLIST_BACKFILL_DONE_KEY, "1");
  assert.equal(await ensureEventPlaylistBackfill(env), 0);
  assert.equal(env.queries.length, 0);
  assert.match(source, /EVENT_PLAYLIST_BACKFILL_CURSOR_KEY/);
  assert.match(source, /EVENT_PLAYLIST_BACKFILL_DONE_KEY/);
});
