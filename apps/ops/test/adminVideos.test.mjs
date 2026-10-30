import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAdminVideoFilters,
  buildAdminVideoHref,
  adminVideoTotalPages,
  adminVideoPageNumbers,
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
  for (const page of ["", "0", "-1", "1e9", "Infinity", "1.4", "0003", "NaN"]) {
    assert.equal(parseAdminVideoFilters(`?page=${page}`).page, 1, page);
  }
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
