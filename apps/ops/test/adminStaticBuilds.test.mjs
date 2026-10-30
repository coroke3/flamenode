import test from "node:test";
import assert from "node:assert/strict";
import { postAdminOp, mutationResultQuery } from "../.test-dist/apps/ops/src/api/adminStaticBuilds.js";

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
  assert.equal(result.status, "ok");
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
