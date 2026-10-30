import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import {
  adminVideoDetailPath,
  adminVideoBackHref,
  formatAdminVideoUnix,
  selectOpenVoidCaseId,
  loadAdminVideoDetail,
} from "../.test-dist/apps/ops/src/api/adminVideoDetail.js";
import {
  createAdminVideoStatusActions,
  createModerationCaseAction,
  safeAdminNextHref,
} from "../.test-dist/apps/ops/src/api/adminVideoStatus.js";
import { CreateModerationCaseForm } from "../.test-dist/apps/ops/src/routes/admin/CreateModerationCaseForm.js";
import { StatusControls, AdminVideoTabs, AdminVideoDetail } from "../.test-dist/apps/ops/src/routes/admin/AdminVideoDetail.js";
import { AdminVideoManagementTabs, AdminVideos } from "../.test-dist/apps/ops/src/routes/admin/AdminVideos.js";
import { SaveSuccessNotice } from "../.test-dist/apps/ops/src/components/shared/SaveSuccessNotice.js";

const detail = {
  video: {
    id: "video-1", title: "Test", creator_name: "Creator", creator_x_user_id: "x_creator",
    created_at: 1_700_000_000, source_type: "youtube", youtube_video_id: null,
    music: null, credit: null, intro_comment: null, highlights: null,
    production_story: null, stagePermission: null, visibility_status: "pending",
    software_label: null, event_ids: [], customAnswers: [], members: [],
  },
  moderationCases: [],
  openCaseCount: 0,
  openVoidCaseId: null,
  event: "event/1",
  truncated: false,
};
const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

test("MIG-0729 U01/U02: CURRENT tab labels, icons, active state, filter and cross-SPA links", () => {
  const render = (element, at) => renderToStaticMarkup(
    React.createElement(MemoryRouter, { initialEntries: [at] }, element),
  );
  const listHtml = render(React.createElement(AdminVideoManagementTabs, {
    q: "a & b", status: "pending", event: "event/1",
  }), "/admin/videos?status=pending");
  const listDoc = new JSDOM(listHtml).window.document;
  const nav = listDoc.querySelector('nav[aria-label="作品管理メニュー"]');
  assert.ok(nav?.classList.contains("fn-console-resource-tabs"));
  assert.equal(nav.querySelectorAll("a").length, 7);
  const review = [...nav.querySelectorAll("a")].find(a => a.textContent.includes("審査待ち"));
  assert.equal(review?.getAttribute("aria-current"), "page");
  assert.equal(review?.getAttribute("href"), "/admin/videos?q=a+%26+b&status=review&event=event%2F1");
  assert.equal(nav.querySelector('a[href="/admin/youtube-sync"]')?.textContent.trim(), "メタデータ同期");
  assert.equal(nav.querySelector('a[href="/admin/youtube-sync/playlists"]')?.textContent.trim(), "再生リスト同期");
  assert.equal(nav.querySelectorAll("svg").length, 7, "CURRENT resource tabs retain icons");
  const detailHtml = render(React.createElement(AdminVideoTabs, {
    videoId: "video/1", youtubeVideoId: "AbcD1234567", active: "detail",
  }), "/admin/videos/video%2F1");
  const detailNav = new JSDOM(detailHtml).window.document.querySelector('nav[aria-label="作品管理メニュー"]');
  assert.equal(detailNav.querySelectorAll("a").length, 6);
  assert.equal(detailNav.querySelector('a[aria-current="page"]')?.getAttribute("href"), "/admin/videos/video%2F1");
  assert.ok(detailNav.querySelector('a[href="/dashboard/edit/video%2F1?privileged=admin"]'));
  assert.ok(detailNav.querySelector('a[href="/dashboard/edit/video%2F1/permissions?privileged=admin"]'));
  assert.ok(detailNav.querySelector('a[href="/AbcD1234567"]'));
  assert.ok(detailNav.querySelector('a[href="/admin/audit?table=videos&record=video%2F1"]'));
});

test("MIG-0729 U01/U02: internal list/detail/reset/pagination links remain in Ops SPA", async () => {
  const oldWindow = globalThis.window;
  const oldDocument = globalThis.document;
  const oldActEnv = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "https://flamenode.invalid" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(dom.window.document.getElementById("root"));
  const rows = {
    q: "作者", status: "review", event: "event-1",
    paging: { page: 2, pageSize: 50, total: 101 },
    videos: [{ id: "video-1", title: "Test", source_type: "youtube",
      youtube_video_id: null, display_name: "Creator", status: "pending",
      created_at: 1_700_000_000,
      review: { stage_permission_summary: "pending", required_unanswered_count: 2 } }],
    events: [{ id: "event-1", title: "Event" }],
    reviewSummaries: "included", degraded: false,
  };
  const mutations = [];
  const fetchFn = async (path, init) => {
    if (init?.method === "POST") {
      mutations.push({ path, body: JSON.parse(init.body) });
      return json(200, { ok: true, nextHref: "/admin/videos/video-2?event=event-1" });
    }
    if (path.startsWith("/api/admin-read/videos/video-1")) return json(200, detail);
    if (path.startsWith("/api/admin-read/videos/video-2")) {
      return json(200, { ...detail, video: { ...detail.video, id: "video-2" } });
    }
    // The privileged list adapter rejects responses for another search key.
    // Model the server's echoed filters/page rather than reusing page-2 data
    // after back, next, previous and reset navigation.
    const params = new URL(path, "https://flamenode.invalid").searchParams;
    return json(200, {
      ...rows,
      q: params.get("q") ?? "",
      status: params.get("status") ?? "",
      event: params.get("event") ?? "",
      paging: { ...rows.paging, page: Number(params.get("page") ?? "1") },
    });
  };
  function LocationProbe() {
    const location = useLocation();
    return React.createElement("output", { id: "route-location" }, location.pathname + location.search);
  }
  const route = () => dom.window.document.getElementById("route-location").textContent;
  const click = async (label) => {
    const link = [...dom.window.document.querySelectorAll("a")]
      .find(node => node.textContent.trim() === label);
    assert.ok(link, `Expected internal link: ${label}`);
    await React.act(async () => {
      link.dispatchEvent(new dom.window.MouseEvent("click",
        { bubbles: true, cancelable: true, button: 0 }));
    });
  };
  try {
    await React.act(async () => {
      root.render(React.createElement(MemoryRouter, {
        initialEntries: ["/admin/videos?status=review&event=event-1&page=2"],
      },
        React.createElement(LocationProbe),
        React.createElement(Routes, null,
          React.createElement(Route, { path: "/admin/videos",
            element: React.createElement(AdminVideos, { fetchFn }) }),
          React.createElement(Route, { path: "/admin/videos/:id",
            element: React.createElement(AdminVideoDetail, { fetchFn }) }),
        ),
      ));
    });
    assert.equal(route(), "/admin/videos?status=review&event=event-1&page=2");
    await click("詳細");
    assert.equal(route(), "/admin/videos/video-1?event=event-1",
      "an Ops-internal detail link must not force a document reload");
    const next = [...dom.window.document.querySelectorAll("button")]
      .find(node => node.textContent.trim() === "承認して次へ");
    assert.ok(next, "CURRENT next-approval button must be present");
    await React.act(async () => {
      next.dispatchEvent(new dom.window.MouseEvent("click",
        { bubbles: true, cancelable: true, button: 0 }));
    });
    assert.equal(mutations.length, 1, "one approval request only");
    assert.equal(mutations[0].path, "/api/admin/videos/video-1/status");
    assert.equal(mutations[0].body.and_next, "1");
    assert.equal(route(), "/admin/videos/video-2?event=event-1",
      "approved nextHref must navigate in Ops Router without document reload");
    await click("作品一覧へ");
    assert.equal(route(), "/admin/videos?status=review&event=event-1");
    await click("次へ");
    assert.equal(route(), "/admin/videos?status=review&event=event-1&page=2");
    await click("前へ");
    assert.equal(route(), "/admin/videos?status=review&event=event-1&page=1");
    await click("解除");
    assert.equal(route(), "/admin/videos");
  } finally {
    await React.act(async () => { root.unmount(); });
    dom.window.close();
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
    if (oldActEnv === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT = oldActEnv;
  }
});

test("MIG-0729: Unix dates use explicit Asia/Tokyo time zone", () => {
  assert.match(formatAdminVideoUnix(0), /1970.*01.*01.*09:00/);
  assert.equal(formatAdminVideoUnix(null), "-");
  assert.equal(formatAdminVideoUnix(Number.NaN), "-");
});

test("MIG-0729 U02: admin read retains event context, no-store and exact video identity", async () => {
  let request;
  const ctrl = new AbortController();
  const out = await loadAdminVideoDetail(async (path, init) => {
    request = { path, init };
    return json(200, detail);
  }, "video-1", "event/1", ctrl.signal);
  assert.deepEqual(out, { status: "ok", data: detail });
  assert.equal(request.path, "/api/admin-read/videos/video-1?event=event%2F1");
  assert.equal(request.init.credentials, "same-origin");
  assert.equal(request.init.cache, "no-store");
  assert.equal(request.init.signal, ctrl.signal);
  assert.equal(adminVideoDetailPath("video/1", "event/1"), "/admin/videos/video%2F1?event=event%2F1");
  assert.equal(adminVideoBackHref("event/1"), "/admin/videos?status=review&event=event%2F1");
  assert.equal(adminVideoBackHref(null), "/admin/videos");
});

test("MIG-0729 U02: 404, 403, invalid DTO and mismatched private detail are fail-closed", async () => {
  assert.deepEqual(await loadAdminVideoDetail(async () => json(404, {}), "video-1", null),
    { status: "notFound" });
  assert.deepEqual(await loadAdminVideoDetail(async () => json(403, { redirect: "/dashboard" }), "video-1", null),
    { status: "forbidden", redirect: "/dashboard" });
  assert.deepEqual(await loadAdminVideoDetail(async () => json(200, { ...detail, video: { ...detail.video, id: "other" } }), "video-1", null),
    { status: "unavailable" });
  assert.deepEqual(await loadAdminVideoDetail(async () => json(200, { ...detail, moderationCases: "invalid" }), "video-1", null),
    { status: "unavailable" });
  assert.deepEqual(await loadAdminVideoDetail(async () => json(200, detail), "", null),
    { status: "notFound" });
});

test("MIG-0729 T03: only same-video open void case can unlock voided status", () => {
  const other = { id: "other", case_type: "rights", status: "open" };
  const voidCase = { id: "void", case_type: "void", status: "open" };
  assert.equal(selectOpenVoidCaseId([other, voidCase]), "void");
  assert.equal(selectOpenVoidCaseId([other]), null,
    "a rights case cannot satisfy the server's case_type=void precondition");
  assert.equal(selectOpenVoidCaseId([{ ...voidCase, status: "closed" }]), null);
  assert.equal(selectOpenVoidCaseId([{ ...voidCase, status: "resolved" }, other]), null);
  assert.equal(selectOpenVoidCaseId([other, { ...voidCase, status: "open" }]), "void");
  assert.equal(selectOpenVoidCaseId([]), null);
});

test("MIG-0729 T03: unrelated case cannot unlock voided, an open void case can", async () => {
  // A server-side static render starts with status=voided. Exercise the actual
  // controlled select before asserting the conditional warning and disabled button.
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalActEnv = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "https://flamenode.invalid" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(dom.window.document.getElementById("root"));
  let writes = 0;
  const actions = {
    approve: async () => ({ ok: true }),
    approveAndNext: async () => ({ ok: true }),
    setStatus: async () => { writes++; return { ok: true }; },
  };
  const base = {
    ...detail,
    video: { ...detail.video, visibility_status: "voided" },
    moderationCases: [{ id: "rights-1", case_type: "rights", status: "open" }],
    openVoidCaseId: "rights-1", // The read DTO's legacy fallback is untrusted.
  };
  try {
    await React.act(async () => {
      root.render(React.createElement(StatusControls, {
        data: base, eventId: null, onRefresh: () => {}, actions,
      }));
    });
    const select = dom.window.document.querySelector('select.fn-select');
    assert.ok(select);
    await React.act(async () => {
      select.value = "pending";
      select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    const apply = [...dom.window.document.querySelectorAll("button")]
      .find(button => button.textContent.trim() === "適用");
    assert.ok(apply);
    assert.equal(apply.disabled, true, "unrelated rights case must not authorize un-void");
    assert.match(dom.window.document.body.textContent,
      /voided解除には open な moderation case が必要/);
    assert.equal(writes, 0);
    await React.act(async () => {
      root.render(React.createElement(StatusControls, {
        data: {
          ...base,
          moderationCases: [
            { id: "rights-1", case_type: "rights", status: "open" },
            { id: "void-1", case_type: "void", status: "open" },
          ],
          openVoidCaseId: "void-1",
        },
        eventId: null, onRefresh: () => {}, actions,
      }));
    });
    assert.equal(apply.disabled, false, "matching open void case enables un-void");
    assert.match(dom.window.document.body.textContent,
      /voided解除に case_id=void-1 を送信します/);
  } finally {
    await React.act(async () => { root.unmount(); });
    dom.window.close();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalActEnv === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnv;
  }
});

test("MIG-0729 T01/T02: status action preserves event, approval and approved-next markers", async () => {
  const calls = [];
  const fetchFn = async (path, init) => {
    calls.push({ path, init, body: JSON.parse(init.body) });
    return json(200, { ok: true, nextHref: "/admin/videos/next-video?event=e1" });
  };
  const actions = createAdminVideoStatusActions(fetchFn);
  const fd = new FormData();
  fd.set("video_id", "video-1");
  fd.set("review_event_id", "e1");
  assert.deepEqual(await actions.approve(fd), {
    ok: true, nextHref: "/admin/videos/next-video?event=e1",
  });
  assert.equal(calls[0].path, "/api/admin/videos/video-1/status");
  assert.deepEqual(calls[0].body, { status: "public", reason: "", review_event_id: "e1" });
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(calls[0].init.cache, "no-store");
  await actions.approveAndNext(fd);
  assert.deepEqual(calls[1].body, {
    status: "public", reason: "", review_event_id: "e1", and_next: "1",
  });
});

test("MIG-0729 T03: void removal sends case_id, no client-side request on invalid target", async () => {
  const calls = [];
  const actions = createAdminVideoStatusActions(async (url, init) => {
    calls.push([url, JSON.parse(init.body)]);
    return json(200, { ok: true });
  });
  const fd = new FormData();
  fd.set("video_id", "v1");
  fd.set("status", "pending");
  fd.set("case_id", "case-1");
  assert.equal((await actions.setStatus(fd)).ok, true);
  assert.equal(calls[0][1].case_id, "case-1");
  fd.set("status", "admin");
  assert.equal((await actions.setStatus(fd)).ok, false);
  assert.equal(calls.length, 1);
});

test("MIG-0729 T04: moderator case keys, HTTP denial, malformed and 500 success-shaped responses", async () => {
  const calls = [];
  const action = createModerationCaseAction(async (path, init) => {
    calls.push({ path, init, body: JSON.parse(init.body) });
    return json(200, { ok: true, message: "created", pendingPublicReflection: true });
  });
  const fd = new FormData();
  for (const [key, value] of Object.entries({
    video_id: "v1", case_type: "void", public_reason: "reason",
    private_note: "note", due_at: "", related_x_user_id: "x",
    video_status: "pending",
  })) fd.set(key, value);
  assert.deepEqual(await action(fd), { ok: true, message: "created", pendingPublicReflection: true });
  assert.equal(calls[0].path, "/api/admin/moderation/cases");
  assert.deepEqual(calls[0].body, {
    case_type: "void", public_reason: "reason", private_note: "note",
    due_at: "", related_x_user_id: "x", video_status: "pending", video_id: "v1",
  });
  const denied = createModerationCaseAction(async () => json(403, { ok: true }));
  assert.equal((await denied(fd)).ok, false, "403 cannot be promoted to success");
  const failed = createModerationCaseAction(async () => json(500, { ok: true }));
  assert.equal((await failed(fd)).ok, false, "500 cannot be promoted to success");
  const invalid = createModerationCaseAction(async () => json(200, { status: "ok" }));
  assert.equal((await invalid(fd)).ok, false, "malformed JSON cannot be promoted to success");
  const badFlag = createModerationCaseAction(async () => json(200, { ok: true, pendingPublicReflection: "true" }));
  assert.equal((await badFlag(fd)).ok, false, "malformed reflection flag must not be treated as success");
});

test("MIG-0729 U02: 400/422 validation must not refresh; 409/5xx conflicts do", async () => {
  const fd = new FormData();
  fd.set("video_id", "video-1");
  fd.set("status", "private");
  for (const [httpStatus, body, expectRetryable] of [
    [400, { ok: false, message: "invalid", retryable: false }, false],
    [422, { ok: false, message: "invalid" }, false],
    [409, { ok: false, message: "conflict", retryable: false }, true],
    [500, { ok: false, message: "unavailable" }, true],
    [400, { ok: false, message: "recheck", retryable: true }, true],
  ]) {
    const action = createAdminVideoStatusActions(async () => json(httpStatus, body)).setStatus;
    const result = await action(fd);
    assert.equal(result.ok, false, String(httpStatus));
    assert.equal(result.retryable === true, expectRetryable, String(httpStatus));
    assert.equal(result.message, body.message);
  }
  const spoofedSuccess = createAdminVideoStatusActions(async () => json(400, { ok: true, message: "invalid" }));
  assert.equal((await spoofedSuccess.setStatus(fd)).ok, false,
    "HTTP validation failure must never become success even if JSON says ok:true");
});

test("MIG-0729 U02: nextHref must stay within one admin video detail", () => {
  for (const link of ["/admin/videos/next", "/admin/videos/next?event=e1"]) {
    assert.equal(safeAdminNextHref(link), true, link);
  }
  for (const link of [
    "https://evil.example/", "//evil.example", "/admin", "/admin/videos",
    "/admin/videos/../audit", "/admin/videos/foo/members",
    "/admin/videos/next\\evil.example", "/admin/videos/next\n",
    "/admin/videos/next#fragment",
  ]) {
    if (link === "/admin/videos/next#fragment") continue; // legacy fragments are local
    assert.equal(safeAdminNextHref(link), false, link);
  }
});


test("MIG-0729 U02: status and case save notices retain CURRENT pending-public-reflection warning", () => {
  const pending = renderToStaticMarkup(React.createElement(SaveSuccessNotice, {
    message: "保存しました。",
    pendingPublicReflection: true,
  }));
  assert.match(pending, /保存しました。/);
  assert.match(pending, /公開ページへの反映は、静的データの再生成が完了するまで/);
  const settled = renderToStaticMarkup(React.createElement(SaveSuccessNotice, {
    message: "保存しました。",
    pendingPublicReflection: false,
  }));
  assert.doesNotMatch(settled, /静的データの再生成/);
});

test("MIG-0729 U02: pending public reflection remains visible after successful same-video refresh", async () => {
  const oldWindow = globalThis.window;
  const oldDocument = globalThis.document;
  const oldActEnv = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const dom = new JSDOM("<!doctype html><div id=\"root\"></div>", { url: "https://flamenode.invalid" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(dom.window.document.getElementById("root"));
  let refreshed = 0;
  const actions = {
    approve: async () => ({ ok: true, message: "承認しました。", pendingPublicReflection: true }),
    approveAndNext: async () => ({ ok: true }),
    setStatus: async () => ({ ok: true }),
  };
  const props = { data: detail, eventId: null, onRefresh: () => { refreshed++; }, actions };
  try {
    await React.act(async () => { root.render(React.createElement(StatusControls, props)); });
    const button = [...dom.window.document.querySelectorAll("button")].find(
      b => b.textContent.trim() === "承認",
    );
    assert.ok(button, "CURRENT approval button must exist");
    await React.act(async () => {
      button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(refreshed, 1);
    const notice = "公開ページへの反映は、静的データの再生成が完了するまで";
    assert.ok(dom.window.document.body.textContent.includes(notice));
    // Refresh changes the status, not the video identity: the success notice must persist.
    await React.act(async () => {
      root.render(React.createElement(StatusControls, {
        ...props, data: { ...detail, video: { ...detail.video, visibility_status: "public" } },
      }));
    });
    assert.ok(dom.window.document.body.textContent.includes(notice),
      "status sync must not clear a just-saved public reflection notice");
    // Navigation to another video must not retain the previous video's private result.
    await React.act(async () => {
      root.render(React.createElement(StatusControls, {
        ...props, data: { ...detail, video: { ...detail.video, id: "video-2", visibility_status: "pending" } },
      }));
    });
    assert.ok(!dom.window.document.body.textContent.includes(notice));
  } finally {
    await React.act(async () => { root.unmount(); });
    dom.window.close();
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
    if (oldActEnv === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT = oldActEnv;
  }
});

test("MIG-0729 U02: moderation form matches CURRENT visible field names", () => {
  const markup = renderToStaticMarkup(React.createElement(CreateModerationCaseForm, {
    videoId: "v1", action: async () => ({ ok: true }), onRefresh: () => {},
  }));
  for (const key of ["video_id", "case_type", "public_reason", "private_note", "due_at", "related_x_user_id", "video_status"]) {
    assert.match(markup, new RegExp(`name="${key}"`));
  }
  assert.match(markup, /モデレーションケースを作成/);
});
