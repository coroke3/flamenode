import test from "node:test";
import assert from "node:assert/strict";
import { postAdminOp, mutationResultQuery, canContinueBackfill, readYoutubeSync, readYoutubePlaylists, readYoutubeQuota, getAdminOps, youtubeSyncFilterParams } from "../.test-dist/apps/ops/src/api/adminStaticBuilds.js";

const response = (status, payload) => new Response(JSON.stringify(payload), {
  status, headers: { "content-type": "application/json" },
});

test("MIG-0735 T01: backfill posts bounded JSON to same-origin admin path", async () => {
  let got;
  const result = await postAdminOp("static-builds/backfill",
    { kind: "video_v2", cursor: "A", mode: "continue" },
    async (path, init) => { got = {path,init}; return response(200, {
      backfill_kind: "video_v2", backfill_done: "0", backfill_cursor: "B",
      backfill_scanned: "1", backfill_enqueued: "1", backfill_state_persisted: "1",
    }); });
  assert.equal(result.status, "outcome");
  assert.equal(got.path, "/api/admin/static-builds/backfill");
  assert.equal(got.init.method, "POST");
  assert.equal(got.init.credentials, "same-origin");
  assert.equal(got.init.cache, "no-store");
  assert.deepEqual(JSON.parse(got.init.body), { kind: "video_v2", cursor: "A", mode: "continue" });
  assert.equal(mutationResultQuery(result.data), "backfill_kind=video_v2&backfill_cursor=B&backfill_scanned=1&backfill_enqueued=1&backfill_done=0&backfill_state_persisted=1");
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

test("MIG-0735 T04: youtube-sync failed-only filter reaches the identical GET query", async () => {
  const expected = {filters:{sync_status:"",privacy:"",availability:"",visibility:"",failed:true,stale:false,missing:false},hasMore:false,truncated:false,rows:[]};
  let call;
  const result = await readYoutubeSync("?failed=1",async (path,init) => {
    call={path,init};return response(200,expected);
  });
  assert.deepEqual(result,{status:"ok",data:expected});
  assert.equal(call.path,"/api/admin-read/ops/youtube-sync?failed=1");
  assert.equal(call.init.method,"GET");
  assert.equal(call.init.credentials,"same-origin");
  assert.equal(call.init.cache,"no-store");
});

test("MIG-0735 T05: 101st playlist row is signaled by hasMore without fabricating a row", async () => {
  const expected={filters:{enabled:"1",status:""},hasMore:true,rows:[]};
  const result=await readYoutubePlaylists("?enabled=1",async (path) => {
    assert.equal(path,"/api/admin-read/ops/youtube-playlists?enabled=1");
    return response(200,expected);
  });
  assert.deepEqual(result,{status:"ok",data:expected});
  assert.equal(result.data.hasMore,true);
});

test("MIG-0735: malformed read DTO and denied request never become success", async () => {
  assert.deepEqual(await readYoutubeSync("", async () => response(200,{hasMore:true,rows:[]})),
    {status:"unavailable"});
  assert.deepEqual(await readYoutubeQuota(async () => response(401,{})),
    {status:"anonymous"});
  assert.deepEqual(await getAdminOps("static-builds",{parse(){throw Error("schema drift");}},
    async () => response(200,{})),{status:"unavailable"});
});

test("MIG-0735 D-17-7: form navigation uses only seven exact filter names", () => {
  const form = new FormData();
  form.set("visibility","review");
  form.set("failed","1");
  form.set("unused","123");
  assert.equal(youtubeSyncFilterParams(form).toString(),"visibility=review&failed=1");
  form.delete("failed");
  assert.equal(youtubeSyncFilterParams(form).toString(),"visibility=review");
});
