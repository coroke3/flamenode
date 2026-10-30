import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { YoutubeSync } from "../.test-dist/apps/ops/src/routes/admin/YoutubeSync.js";
import { YoutubePlaylists } from "../.test-dist/apps/ops/src/routes/admin/YoutubePlaylists.js";
import { StaticRebuildQueuePanel, staticRebuildAdminHref } from "../.test-dist/apps/ops/src/routes/admin/StaticRebuildQueuePanel.js";
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

test("MIG-0735 T04 UI: real rendered sync filters preserve CURRENT embed-disabled and four visibility groups", () => {
  const html=renderToStaticMarkup(React.createElement(MemoryRouter,
    {initialEntries:["/admin/youtube-sync?availability=embed_disabled&visibility=closed"]},
    React.createElement(YoutubeSync)));
  const availability=html.match(/<select name="availability"[^>]*>([\s\S]*?)<\/select>/)?.[1];
  const visibility=html.match(/<select name="visibility"[^>]*>([\s\S]*?)<\/select>/)?.[1];
  assert.ok(availability, "availability filter must be rendered");
  assert.ok(visibility, "visibility filter must be rendered");
  assert.match(availability, /value="embed_disabled"/);
  assert.deepEqual([...visibility.matchAll(/<option value="([^"]+)"/g)].map(m=>m[1]),
    ["","review","public","private","closed"]);
  assert.match(html, /name="failed"/);
  assert.match(html, /name="stale"/);
  assert.match(html, /name="missing"/);
});

test("MIG-0735 T05 UI: playlist screen renders CURRENT enabled and health filters without fetching on server", () => {
  const html=renderToStaticMarkup(React.createElement(MemoryRouter,
    {initialEntries:["/admin/youtube-sync/playlists?enabled=0&status=failed"]},
    React.createElement(YoutubePlaylists)));
  const enabled=html.match(/<select name="enabled"[^>]*>([\s\S]*?)<\/select>/)?.[1];
  const status=html.match(/<select name="status"[^>]*>([\s\S]*?)<\/select>/)?.[1];
  assert.ok(enabled);
  assert.ok(status);
  assert.deepEqual([...enabled.matchAll(/<option value="([^"]*)"/g)].map(m=>m[1]),["","1","0"]);
  assert.deepEqual([...status.matchAll(/<option value="([^"]*)"/g)].map(m=>m[1]),
    ["","disabled","idle","scanning","synced","deferred","failed"]);
});

test("MIG-0735 queue UI: linked targets are encoded and unknown future top_* cannot silently redirect", () => {
  assert.equal(staticRebuildAdminHref("event_release","ev/1"),"/manage/events/ev%2F1");
  assert.equal(staticRebuildAdminHref("top_slot_stats","global"),"/");
  assert.equal(staticRebuildAdminHref("top_unrecognized","global"),null);
  assert.equal(staticRebuildAdminHref("user","name + space"),"/admin/users?q=name%20%2B%20space");
  const html=renderToStaticMarkup(React.createElement(MemoryRouter,null,
    React.createElement(StaticRebuildQueuePanel,{
      rows:[{id:"queue1",status:"failed",target_type:"event_release",target_id:"ev/1",
        reason:"manual_rebuild",priority:"high",attempt_count:2,updated_at:1,error:"safe text"}],
      busy:false,retry:()=>{},retryAll:()=>{},
    })));
  assert.match(html,/href="\/manage\/events\/ev%2F1"/);
  assert.match(html,/再試行/);
  assert.match(html,/失敗 1 件を一括再試行/);
});
