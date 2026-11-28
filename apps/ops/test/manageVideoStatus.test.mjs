import test from "node:test";
import assert from "node:assert/strict";
import { createManageVideoStatusActions } from "../.test-dist/apps/ops/src/api/manageVideoStatus.js";

const result = (status, value) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json" },
});
const form = (extra = {}) => {
  const fd = new FormData();
  fd.set("event_id", "event/1");
  fd.set("video_id", "vid/1");
  for (const [key, value] of Object.entries(extra)) fd.set(key, value);
  return fd;
};
test("MIG-0724 U04: all status operations use only event-scoped JSON POST and original FormData keys", async () => {
  const seen = [];
  const api = createManageVideoStatusActions(async (path, init) => {
    seen.push({ path, init, data: JSON.parse(init.body) });
    return result(200, { ok: true, message: "保存しました。" });
  }, "event/1");
  assert.equal((await api.approve(form())).ok, true);
  assert.equal((await api.approveAndNext(form())).ok, true);
  assert.equal((await api.setStatus(form({ status: "private", reason: "保留" }))).ok, true);
  assert.equal(seen.length, 3);
  for (const item of seen) {
    assert.equal(item.path, "/api/manage/events/event%2F1/videos/vid%2F1/status");
    assert.equal(item.init.method, "POST");
    assert.equal(item.init.credentials, "same-origin");
    assert.equal(item.init.cache, "no-store");
    assert.equal(item.init.headers["content-type"], "application/json");
  }
  assert.deepEqual(seen.map(x => x.data), [
    { status: "public", reason: "", and_next: "0" },
    { status: "public", reason: "", and_next: "1" },
    { status: "private", reason: "保留", and_next: "0" },
  ]);
});
test("MIG-0724 U04: disallow other event, missing ID, unknown status without a fetch", async () => {
  let writes = 0;
  const api = createManageVideoStatusActions(async () => { writes++; return result(200, { ok: true }); }, "event/1");
  for (const fd of [
    form({ event_id: "event/2" }), form({ video_id: "" }),
    form({ status: "voided" }), form({ status: "invalid" }),
  ]) {
    assert.equal((await api.setStatus(fd)).ok, false);
  }
  assert.equal(writes, 0);
});
test("MIG-0724 U04: API fails closed on HTTP 401/403/404/501/503, malformed response or network loss", async () => {
  const cases = [
    [401, { ok: true }], [403, { ok: true }], [404, { ok: true }],
    [501, { ok: true }], [503, { ok: true }],
    [200, { ok: "yes" }], [200, { ok: true, nextHref: { to: "/admin" } }],
    [200, { ok: true, pendingPublicReflection: "yes" }],
  ];
  for (const [status, payload] of cases) {
    const api = createManageVideoStatusActions(async () => result(status, payload), "event/1");
    const res = await api.approve(form());
    assert.equal(res.ok, false, `${status} ${JSON.stringify(payload)}`);
  }
  const failed = createManageVideoStatusActions(async () => { throw new Error("offline"); }, "event/1");
  assert.deepEqual(await failed.approve(form()), {
    ok: false, message: "通信状態を確認し、作品の現在の状態を再取得してください。", retryable: true,
  });
});
test("MIG-0724 U04: successful response retains safe typed fields for UI, never follows nextHref itself", async () => {
  const api = createManageVideoStatusActions(async () => result(200, {
    ok: true, message: "承認しました。", nextHref: "/manage/events/event%2F1/videos/next",
    pendingPublicReflection: true,
  }), "event/1");
  const res = await api.approveAndNext(form());
  assert.deepEqual(res, {
    ok: true, message: "承認しました。", nextHref: "/manage/events/event%2F1/videos/next",
    pendingPublicReflection: true,
  }, "expected output should retain CURRENT message without rewriting");
});
