import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAdminVideoFilters,
  buildAdminVideoHref,
  adminVideoFilterHref,
  adminVideoTotalPages,
  adminVideoPageNumbers,
  adminVideoRelativeLabel,
  loadAdminVideos,
} from "../.test-dist/apps/ops/src/api/adminVideos.js";

const fixture = {
  q: "作者",
  status: "review",
  event: "event-1",
  paging: { page: 3, pageSize: 50, total: 121 },
  videos: [{
    id: "video-1", title: "Example", source_type: "youtube",
    youtube_video_id: null, display_name: "creator", status: "pending",
    created_at: 1_700_000_000,
    review: { stage_permission_summary: "pending", required_unanswered_count: 2 },
  }],
  events: [{ id: "event-1", title: "Event" }],
  reviewSummaries: "included",
  degraded: false,
};
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

test("MIG-0729 U01: first query values, status normalization, overflow and page clamping", () => {
  assert.deepEqual(parseAdminVideoFilters("?q=a&q=b&status=review&event=e1&page=3"), {
    q: "a", status: "review", event: "e1", page: 3,
  });
  assert.equal(parseAdminVideoFilters("?status=constructor&page=999999999999999999").status, "");
  for (const page of ["", "0", "-1", "Infinity", "NaN", "999999999999999999"]) {
    assert.equal(parseAdminVideoFilters(`?page=${page}`).page, 1, page);
  }
  for (const [raw, expected] of [["0003", 3], ["3.8", 3], ["1e2", 100], [" 2 ", 2]]) {
    assert.equal(parseAdminVideoFilters(`?page=${encodeURIComponent(raw)}`).page, expected, raw);
  }
  // In the Hono read path a numeric page must also produce a safe SQLite OFFSET.
  const unsafeOffsetPage = String(Math.floor(Number.MAX_SAFE_INTEGER / 50) + 2);
  assert.equal(parseAdminVideoFilters(`?page=${unsafeOffsetPage}`).page, 1);
  assert.equal(parseAdminVideoFilters("?status=all").status, "");
  assert.equal(parseAdminVideoFilters("?status=pending").status, "pending");
});

test("MIG-0729 T05: page 3 preserves CURRENT q/status/event query and link ordering", () => {
  const filters = { q: "a & b", status: "review", event: "event/1" };
  assert.equal(
    buildAdminVideoHref(filters, 3),
    "/admin/videos?q=a+%26+b&status=review&event=event%2F1&page=3",
  );
  assert.equal(buildAdminVideoHref({ q: "", status: "", event: "" }), "/admin/videos");
  assert.equal(buildAdminVideoHref({ ...filters, status: "public" }),
    "/admin/videos?q=a+%26+b&status=public&event=event%2F1");
  assert.equal(adminVideoTotalPages(fixture.paging), 3);
  assert.equal(adminVideoTotalPages({ page: 1, pageSize: 50, total: 0 }), 1);
  assert.deepEqual(adminVideoPageNumbers(3, 12), [1, 2, 3, 4, 5, "…", 12]);
  assert.deepEqual(adminVideoPageNumbers(8, 12), [1, "…", 6, 7, 8, 9, 10, "…", 12]);
  assert.deepEqual(adminVideoPageNumbers(12, 12), [1, "…", 10, 11, 12]);

});

test("MIG-0729 U01: Ops SPA GET form navigation updates q/event/status and drops old page", () => {
  const form = new FormData();
  form.set("q", "a & b");
  form.set("status", "review");
  form.set("event", "event/1");
  form.set("page", "9"); // stale page must not survive a new filter
  assert.equal(adminVideoFilterHref(form),
    "/admin/videos?q=a+%26+b&status=review&event=event%2F1");
  form.set("status", "invalid");
  assert.equal(adminVideoFilterHref(form),
    "/admin/videos?q=a+%26+b&event=event%2F1");
  form.set("q", "");
  form.set("event", "");
  assert.equal(adminVideoFilterHref(form), "/admin/videos");
});

test("MIG-0729 U01: CURRENT relative labels accept Unix epoch, future and interval boundaries", () => {
  assert.equal(adminVideoRelativeLabel(0, 120), "2分前");
  assert.equal(adminVideoRelativeLabel(40, 90), "今");
  assert.equal(adminVideoRelativeLabel(150, 90), "今");
  assert.equal(adminVideoRelativeLabel(0, 3600), "1時間前");
  assert.equal(adminVideoRelativeLabel(0, 86400), "1日前");
  assert.equal(adminVideoRelativeLabel(0, 2592000), "1か月前");
  assert.equal(adminVideoRelativeLabel(0, 31536000), "1年前");
  assert.equal(adminVideoRelativeLabel(Number.NaN, 100), "");
});

test("MIG-0729 U01: GET uses same-origin/no-store, exact page filters and abort signal", async () => {
  let request;
  const controller = new AbortController();
  const response = await loadAdminVideos(async (path, init) => {
    request = { path, init };
    return json(fixture);
  }, "?q=%E4%BD%9C%E8%80%85&status=review&event=event-1&page=3", controller.signal);
  assert.deepEqual(response, { status: "ok", data: fixture });
  assert.equal(request.path, "/api/admin-read/videos?q=%E4%BD%9C%E8%80%85&status=review&event=event-1&page=3");
  assert.equal(request.init.method, "GET");
  assert.equal(request.init.credentials, "same-origin");
  assert.equal(request.init.cache, "no-store");
  assert.equal(request.init.signal, controller.signal);
});

test("MIG-0729 U01: private list must match exact request scope and bounded paging", async () => {
  const search = "?q=%E4%BD%9C%E8%80%85&status=review&event=event-1&page=3";
  const read = body => loadAdminVideos(async () => json(body), search);
  assert.deepEqual(await read(fixture), { status: "ok", data: fixture });
  for (const mismatch of [
    { q: "other" }, { status: "public" }, { event: "event-2" },
    { paging: { ...fixture.paging, page: 2 } },
    { paging: { ...fixture.paging, pageSize: 100 } },
    { paging: { ...fixture.paging, total: -1 } },
    { paging: { ...fixture.paging, total: 1.5 } },
    { paging: { ...fixture.paging, total: 0 } },
    { videos: [fixture.videos[0], fixture.videos[0]] },
    { videos: Array.from({ length: 51 }, (_, i) => ({
      ...fixture.videos[0], id: `video-${i}`,
    })) },
  ]) {
    const response = await read({ ...fixture, ...mismatch });
    assert.deepEqual(response, { status: "unavailable" },
      `unexpected scoped/bounded DTO: ${JSON.stringify(mismatch).slice(0, 140)}`);
  }
  // An actual backend read failure returns a same-key degraded empty list.
  const degraded = {
    ...fixture, paging: { page: 3, pageSize: 50, total: 0 },
    videos: [], events: [], degraded: true,
  };
  assert.deepEqual(await read(degraded), { status: "ok", data: degraded });
});

test("MIG-0729 U01: invalid private response fails closed, including malformed paging", async () => {
  assert.deepEqual(await loadAdminVideos(async () => json({ ...fixture, videos: "not-an-array" }), ""),
    { status: "unavailable" });
  assert.deepEqual(await loadAdminVideos(async () => json({
    ...fixture, paging: { page: "3", pageSize: 50, total: 121 },
  }), ""), { status: "unavailable" });
  assert.deepEqual(await loadAdminVideos(async () => new Response("invalid", { status: 200 }), ""),
    { status: "unavailable" });
});

test("MIG-0729 U01: revocation/absence and offline never return old video data", async () => {
  assert.deepEqual(await loadAdminVideos(async () => json({ redirect: "/dashboard" }, 403), ""),
    { status: "forbidden", redirect: "/dashboard" });
  assert.deepEqual(await loadAdminVideos(async () => json({}, 401), ""), { status: "anonymous" });
  assert.deepEqual(await loadAdminVideos(async () => json({}, 404), ""), { status: "notFound" });
  assert.deepEqual(await loadAdminVideos(async () => { throw new Error("offline"); }, ""),
    { status: "unavailable" });
  const controller = new AbortController();
  assert.deepEqual(await loadAdminVideos(async () => {
    controller.abort();
    return json(fixture);
  }, "", controller.signal), { status: "unavailable" });
});
