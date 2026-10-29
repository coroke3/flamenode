import assert from "node:assert/strict";
import { test } from "node:test";
import { runPageRenderRecoveryStage } from "./index.ts";
import { MAX_RECOVERY_DOORBELLS } from "../../apps/site/src/gateway/pageRenderRecovery.ts";

test("MIG-0411 T07: optional producer absent -> skipped without any D1 statement", async () => {
  const db = { prepare() { throw new Error("DB must not be queried without Queue binding"); } };
  assert.deepEqual(await runPageRenderRecoveryStage({ DB: db }), { skipped: 1 });
});

test("MIG-0411 T07: pending rows send doorbells in order with one bounded D1 SELECT", async () => {
  const sql = [];
  const queue = [];
  const rows = [
    { entity: "event", entity_id: "e1" },
    { entity: "video", entity_id: "v1" },
    { entity: "user", entity_id: "u1" },
  ];
  const db = {
    prepare(query) {
      sql.push(query);
      return {
        bind(limit) {
          assert.equal(limit, MAX_RECOVERY_DOORBELLS);
          return { all: async () => ({ results: rows }) };
        },
      };
    },
  };
  const result = await runPageRenderRecoveryStage({
    DB: db,
    PAGE_RENDER_QUEUE: { send: async (body) => { queue.push(body); } },
  });
  assert.deepEqual(result, { processed: 3, skipped: 0 });
  assert.equal(sql.length, 1);
  assert.match(sql[0], /request_version > rendered_version/);
  assert.match(sql[0], /ORDER BY requested_at ASC LIMIT \\?/);
  assert.deepEqual(queue, [
    { type: "render-page", kind: "event", id: "e1" },
    { type: "render-page", kind: "video", id: "v1" },
    { type: "render-page", kind: "user", id: "u1" },
  ]);
});

test("MIG-0411 T07: send failure stays retryable (Cron reports failure on this invocation)", async () => {
  const db = { prepare() { return { bind() { return { all: async () => ({ results: [
    { entity: "video", entity_id: "v1" },
  ] }) }; } }; } };
  await assert.rejects(runPageRenderRecoveryStage({
    DB: db,
    PAGE_RENDER_QUEUE: { send: async () => { throw new Error("queue unavailable"); } },
  }), /queue unavailable/);
});
