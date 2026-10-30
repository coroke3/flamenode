import test from "node:test";
import assert from "node:assert/strict";
import { postAdminOp, mutationResultQuery, canContinueBackfill } from "../.test-dist/apps/ops/src/api/adminStaticBuilds.js";

const response = (status, payload) => new Response(JSON.stringify(payload), {
  status, headers: { "content-type": "application/json" },
});

test("MIG-0735 T01: backfill posts bounded JSON to same-origin admin path", async () => {
  let got;
  const result = await postAdminOp("static-builds/backfill",
    { kind: "video_v2", cursor: "A", mode: "continue" },
    async (path, init) => { got = {path,init}; return response(200, {
      backfill_kind: "video_v2", backfill_done: "0", backfill_cursor: "B",
    }); });
  assert.equal(result.status, "outcome");
  assert.equal(got.path, "/api/admin/static-builds/backfill");
  assert.equal(got.init.method, "POST");
  assert.equal(got.init.credentials, "same-origin");
  assert.equal(got.init.cache, "no-store");
  assert.deepEqual(JSON.parse(got.init.body), { kind: "video_v2", cursor: "A", mode: "continue" });
  assert.equal(mutationResultQuery(result.data), "backfill_kind=video_v2&backfill_cursor=B&backfill_done=0");
});

test("MIG-0735 T03: visibility repair only writes allowed query keys", () => {
  const q = mutationResultQuery({ visibility_repair: "repaired", url: "//evil.example", backfill_error: 123 });
  assert.equal(q, "visibility_repair=repaired");
});

test("MIG-0735: denied, failed, and invalid mutation responses fail closed", async () => {
  for (const [status, payload, expected] of [
    [401, {}, "anonymous"],
    [403, {}, "forbidden"],
    [409, { ok: false }, "unavailable"],
    [503, { ok: false }, "unavailable"],
    [200, { ok: false }, "unavailable"],
    [200, [], "unavailable"],
  ]) {
    assert.equal((await postAdminOp("static-builds/rebuild", {}, async () => response(status, payload))).status, expected);
  }
});

test("MIG-0735 T02: a completed backfill disables continuation but restart is separate", () => {
  assert.equal(canContinueBackfill("completed"), false);
  assert.equal(canContinueBackfill("running"), true);
  assert.equal(canContinueBackfill("failed"), true);
});

test("MIG-0735 T03: visibility repair status codes retain CURRENT result query", async () => {
  for (const [status, code] of [
    [200, "repaired"], [200, "d1_fence_present"], [200, "manifest_token_not_found"],
    [400, "invalid_input"], [413, "invalid_input"], [500, "failed"],
  ]) {
    const result = await postAdminOp("visibility-repair", {}, async () => response(status, {visibility_repair: code}));
    assert.equal(result.status, "outcome");
    assert.equal(mutationResultQuery(result.data), "visibility_repair=" + code);
  }
});
test("MIG-0735 T01: backfill failure remains a visible result (not a silent generic 500)", async () => {
  const result = await postAdminOp("static-builds/backfill", {},
    async () => response(500, {backfill_kind:"event_crew", backfill_error:"query_failed", backfill_state_persisted:"0"}));
  assert.equal(result.status, "outcome");
  assert.equal(mutationResultQuery(result.data),
    "backfill_kind=event_crew&backfill_error=query_failed&backfill_state_persisted=0");
});
test("MIG-0735: unexpected 200 body and fake 500 result fail closed", async () => {
  assert.equal((await postAdminOp("static-builds/rebuild", {},
    async () => response(200, {}))).status, "unavailable");
  assert.equal((await postAdminOp("visibility-repair", {},
    async () => response(500, {visibility_repair:"repaired"}))).status, "unavailable");
  assert.equal((await postAdminOp("static-builds/backfill", {},
    async () => response(200, {backfill_kind:"video_v2"}))).status, "unavailable");
});
