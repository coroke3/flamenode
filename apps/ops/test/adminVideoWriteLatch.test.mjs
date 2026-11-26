import assert from "node:assert/strict";
import test from "node:test";
import { applyAdminVideoMemberPermissionBatch } from "../.test-dist/apps/ops/src/api/adminVideoMemberPermissions.js";
import { saveAdminVideoMembers } from "../.test-dist/apps/ops/src/api/adminVideoMemberSave.js";

const receipt = videoId => new Response(JSON.stringify({ ok: true, videoId }), {
  status: 200, headers: { "content-type": "application/json" },
});

const permission = videoId => ({
  videoId, notify: true,
  intents: [{ x_user_id: "@ALICE", display_name: "Alice", intent: "on" }],
});
const memberForm = videoId => {
  const form = new FormData();
  form.set("video_id", videoId);
  form.append("is_collab", "false");
  form.append("is_collab", "true");
  form.set("members_json", JSON.stringify([{ name: "Alice" }]));
  return form;
};

const request = (kind, videoId, fetchFn) =>
  kind === "permission"
    ? applyAdminVideoMemberPermissionBatch(permission(videoId), fetchFn)
    : saveAdminVideoMembers(videoId, memberForm(videoId), fetchFn);

test("MIG-0730 U02bm: SA-084 POST and SA-085 PUT share one same-video in-module write latch", async () => {
  for (const [initial, blocked] of [
    ["permission", "members"],
    ["members", "permission"],
  ]) {
    for (const outcome of ["success", "lost_response"]) {
      const videoId = "u02bm-" + initial + "-" + outcome;
      const otherVideoId = "another-" + videoId;
      const requests = [];
      let resolveFirst, rejectFirst;
      const waiting = new Promise((resolve, reject) => {
        resolveFirst = resolve; rejectFirst = reject;
      });
      const original = request(initial, videoId, (path, init) => {
        requests.push({ path, method: init.method });
        return waiting;
      });
      assert.equal(requests.length, 1);
      assert.equal(requests[0].method, initial === "permission" ? "POST" : "PUT");

      const refused = await request(blocked, videoId, (path, init) => {
        requests.push({ path, method: init.method });
        return Promise.resolve(receipt(videoId));
      });
      assert.equal(refused.ok, false);
      assert.match(refused.message, /処理中/);
      assert.equal(requests.length, 1,
        "the other write kind must not reach HTTP for the same pending video");

      const independent = await request(blocked, otherVideoId, (path, init) => {
        requests.push({ path, method: init.method });
        return Promise.resolve(receipt(otherVideoId));
      });
      assert.deepEqual(independent, { ok: true }, "different video must remain writable");
      assert.equal(requests.length, 2);

      if (outcome === "success") resolveFirst(receipt(videoId));
      else rejectFirst(new Error("response lost after a possible DB commit"));
      const settled = await original;
      assert.equal(settled.ok, outcome === "success");
      assert.equal(requests.length, 2, "unknown result must never auto-retry");

      const explicit = await request(blocked, videoId, (path, init) => {
        requests.push({ path, method: init.method });
        return Promise.resolve(receipt(videoId));
      });
      assert.deepEqual(explicit, { ok: true },
        "an explicit action after first write settles must be permitted");
      assert.equal(requests.length, 3);
    }
  }
});

test("MIG-0730 U02dv: HTTP 401 releases the shared SA-084/085 latch without decoding, replay or cross-video blocking", async () => {
  for (const [initial, next] of [["permission", "members"], ["members", "permission"]]) {
    for (const status of [401, 403]) {
      const videoId = "u02dv-" + initial + "-" + status;
      const otherVideoId = "another-" + videoId;
      const requests = [];
      let resolveFirst;
      let bodyReads = 0;
      const waiting = new Promise(resolve => { resolveFirst = resolve; });
      const original = request(initial, videoId, (path, init) => {
        requests.push({ path, method: init.method });
        return waiting;
      });
      assert.equal(requests.length, 1);
      assert.equal(requests[0].method, initial === "permission" ? "POST" : "PUT");
      const blocked = await request(next, videoId, (path, init) => {
        requests.push({ path, method: init.method });
        return Promise.resolve(receipt(videoId));
      });
      assert.equal(blocked.ok, false);
      assert.equal(blocked.reason, undefined, "local contention is not HTTP authentication loss");
      assert.match(blocked.message, /処理中/);
      assert.equal(requests.length, 1);
      assert.deepEqual(await request(next, otherVideoId, (path, init) => {
        requests.push({ path, method: init.method });
        return Promise.resolve(receipt(otherVideoId));
      }), { ok: true });
      assert.equal(requests.length, 2);
      resolveFirst({
        status,
        json() { bodyReads++; return { ok: true, videoId, reason: "unauthenticated" }; },
      });
      const settled = await original;
      assert.equal(settled.ok, false);
      if (status === 401) {
        assert.deepEqual(settled, { ok: false, reason: "unauthenticated", message: "再ログインが必要です。" });
      } else {
        assert.equal(settled.reason, undefined, "403 cannot fabricate a 401 classification");
      }
      assert.equal(bodyReads, 0);
      assert.equal(requests.length, 2, "neither write is automatically replayed");
      // Simulate a separately authorized explicit attempt only; actual host
      // must retire the old authority and revalidate data before allowing it.
      assert.deepEqual(await request(next, videoId, (path, init) => {
        requests.push({ path, method: init.method });
        return Promise.resolve(receipt(videoId));
      }), { ok: true });
      assert.equal(requests.length, 3);
      assert.equal(requests[2].method, next === "permission" ? "POST" : "PUT");
    }
  }
});
