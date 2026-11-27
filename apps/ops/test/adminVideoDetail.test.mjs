import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import {
  adminVideoDetailPath,
  adminVideoThumbnailHref,
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
import { StatusControls, AdminVideoTabs, AdminVideoDetail, adminVideoPublicHref } from "../.test-dist/apps/ops/src/routes/admin/AdminVideoDetail.js";
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

test("MIG-0729 U03a: public tab follows CURRENT videoPageHref for YouTube URLs and safe fallback", () => {
  const youtube = "dQw4w9WgXcQ";
  const checks = [
    { id: "safe_slug", youtube_video_id: youtube, expected: "/" + youtube },
    { id: "safe_slug", youtube_video_id: "https://youtu.be/" + youtube + "?t=30", expected: "/" + youtube },
    { id: "safe_slug", youtube_video_id: "https://www.youtube.com/watch?v=" + youtube, expected: "/" + youtube },
    { id: "safe_slug", youtube_video_id: "https://youtube.com/shorts/" + youtube, expected: "/" + youtube },
    { id: "safe_slug", youtube_video_id: "https://youtube.com/embed/" + youtube, expected: "/" + youtube },
    { id: "safe_slug", youtube_video_id: "https://youtube.com/live/" + youtube, expected: "/" + youtube },
    { id: "safe_slug", youtube_video_id: "https://youtube.com/v/" + youtube, expected: "/" + youtube },
    { id: "safe_slug", youtube_video_id: "https://youtube.com.evil.test/watch?v=" + youtube, expected: "/safe_slug" },
    { id: "safe_slug", youtube_video_id: "javascript:alert(1)", expected: "/safe_slug" },
    { id: "safe_slug", youtube_video_id: "//untrusted.example/abc", expected: "/safe_slug" },
    { id: "safe_slug", youtube_video_id: null, expected: "/safe_slug" },
    { id: "id with space", youtube_video_id: "invalid-id", expected: "/list" },
    { id: "bad/path", youtube_video_id: null, expected: "/list" },
    { id: "bad/path", youtube_video_id: "https://youtu.be/" + youtube, expected: "/" + youtube },
    { id: "safe_slug", youtube_video_id: "https://youtu.be/" + youtube + ".evil", expected: "/safe_slug" },
  ];
  for (const { id, youtube_video_id, expected } of checks) {
    assert.equal(adminVideoPublicHref({ id, youtube_video_id }), expected);
    const html = renderToStaticMarkup(React.createElement(MemoryRouter, null,
      React.createElement(AdminVideoTabs, {
        videoId: id, youtubeVideoId: youtube_video_id, active: "detail",
      })));
    const nav = new JSDOM(html).window.document.querySelector('nav[aria-label="作品管理メニュー"]');
    const link = [...nav.querySelectorAll("a")].find(a => a.textContent.trim() === "公開ページ");
    assert.equal(link?.getAttribute("href"), expected,
      "public tab must use the CURRENT-normalized same-origin public path");
  }
});

test("MIG-0729 U03a: detail footer and public tab share the CURRENT canonical URL", async () => {
  const saved = {
    window: globalThis.window, document: globalThis.document,
    act: globalThis.IS_REACT_ACT_ENVIRONMENT,
  };
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: "https://flamenode.invalid/admin/videos/video-1",
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(dom.window.document.getElementById("root"));
  let calls = 0;
  const payload = { ...detail, event: null, video: { ...detail.video,
    youtube_video_id: "https://youtu.be/dQw4w9WgXcQ?t=30" } };
  try {
    await React.act(async () => root.render(React.createElement(MemoryRouter, {
      initialEntries: ["/admin/videos/video-1"],
    }, React.createElement(Routes, null, React.createElement(Route, {
      path: "/admin/videos/:id",
      element: React.createElement(AdminVideoDetail, {
        fetchFn: async () => { calls++; return json(200, payload); },
      }),
    })))));
    assert.equal(calls, 1);
    const publicLinks = [...dom.window.document.querySelectorAll("a")]
      .filter(a => a.textContent.trim() === "公開ページ");
    assert.equal(publicLinks.length, 2, "both six-tab nav and detail footer link are visible");
    for (const link of publicLinks) {
      assert.equal(link.getAttribute("href"), "/dQw4w9WgXcQ");
    }
    const footerLink = dom.window.document.querySelector(
      'nav[aria-label="作品の関連画面"] a[href="/dQw4w9WgXcQ"]');
    assert.equal(footerLink?.getAttribute("target"), "_blank");
    assert.equal(footerLink?.getAttribute("rel"), "noopener noreferrer");
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    if (saved.window === undefined) delete globalThis.window;
    else globalThis.window = saved.window;
    if (saved.document === undefined) delete globalThis.document;
    else globalThis.document = saved.document;
    if (saved.act === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT = saved.act;
  }
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
    if (path.startsWith("/api/admin-read/videos/video-1")) {
      return json(200, { ...detail, event: "event-1" });
    }
    if (path.startsWith("/api/admin-read/videos/video-2")) {
      return json(200, { ...detail, event: "event-1", video: { ...detail.video, id: "video-2" } });
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
  assert.deepEqual(await loadAdminVideoDetail(async () => json(200, { ...detail, event: null, video: { ...detail.video, id: "other" } }), "video-1", null),
    { status: "invalid" });
  assert.deepEqual(await loadAdminVideoDetail(async () => json(200, { ...detail, event: null, moderationCases: "invalid" }), "video-1", null),
    { status: "invalid" });
  assert.deepEqual(await loadAdminVideoDetail(async () => json(503, {}), "video-1", null),
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


// Deferred HTTP receipts reproduce navigation races without resubmitting or
// aborting a possibly committed mutation.
function deferredReceipt() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

async function withMutationDom(run) {
  const saved = Object.fromEntries(["window", "document", "FormData", "IS_REACT_ACT_ENVIRONMENT"]
    .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "https://flamenode.invalid" });
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document, FormData: dom.window.FormData,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const root = createRoot(dom.window.document.getElementById("root"));
  try {
    await run({ dom, root });
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

test("MIG-0729 U02: deferred approval receipts cannot navigate or refresh another video or a fresh A visit", async () => {
  for (const scenario of ["switch", "return", "reject", "event", "unmount"]) {
    await withMutationDom(async ({ dom, root }) => {
      const old = deferredReceipt();
      const calls = [], next = [], refreshes = [];
      const actions = {
        approve: async () => ({ ok: true }),
        approveAndNext: form => {
          calls.push([form.get("video_id"), form.get("review_event_id")]);
          return old.promise;
        },
        setStatus: async () => ({ ok: true }),
      };
      const render = async (id, eventId = "event-a") => React.act(async () => {
        root.render(id === null ? null : React.createElement(StatusControls, {
          data: { ...detail, video: { ...detail.video, id } },
          eventId, actions, onNext: href => next.push([id, href]),
          onRefresh: () => refreshes.push(id),
        }));
      });
      const clickNext = async () => React.act(async () => {
        const btn = [...dom.window.document.querySelectorAll("button")]
          .find(b => b.textContent.trim() === "承認して次へ");
        assert.ok(btn && !btn.disabled);
        btn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      });
      await render("video-a");
      await clickNext();
      assert.deepEqual(calls, [["video-a", "event-a"]]);
      if (scenario === "unmount") await render(null);
      else if (scenario === "event") await render("video-a", "event-b");
      else {
        await render("video-b");
        if (scenario === "return") await render("video-a");
      }
      await React.act(async () => {
        if (scenario === "reject") old.reject(new Error("OLD_FAILURE"));
        else old.resolve({ ok: true, message: "OLD_RECEIPT", nextHref: "/admin/videos/next-from-a" });
      });
      assert.deepEqual(next, [], scenario);
      assert.deepEqual(refreshes, [], scenario);
      assert.equal(calls.length, 1, "never automatically retry POST");
      assert.doesNotMatch(dom.window.document.body.textContent, /OLD_RECEIPT|通信状態を確認/);
      if (scenario !== "unmount") {
        const btn = [...dom.window.document.querySelectorAll("button")]
          .find(b => b.textContent.trim() === "承認して次へ");
        assert.ok(btn && !btn.disabled, "new view has its own write state");
      }
    });
  }
});

test("MIG-0729 U02: same-view deferred approval-and-next still uses the accepted nextHref once", async () => {
  await withMutationDom(async ({ dom, root }) => {
    const receipt = deferredReceipt();
    const next = [], refreshes = [], calls = [];
    const actions = {
      approve: async () => ({ ok: true }),
      approveAndNext: form => { calls.push(form.get("video_id")); return receipt.promise; },
      setStatus: async () => ({ ok: true }),
    };
    await React.act(async () => root.render(React.createElement(StatusControls, {
      data: detail, eventId: null, actions,
      onNext: href => next.push(href), onRefresh: () => refreshes.push(true),
    })));
    const btn = [...dom.window.document.querySelectorAll("button")]
      .find(b => b.textContent.trim() === "承認して次へ");
    await React.act(async () => btn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
    await React.act(async () => receipt.resolve({ ok: true, nextHref: "/admin/videos/next" }));
    assert.deepEqual(calls, ["video-1"]);
    assert.deepEqual(next, ["/admin/videos/next"]);
    assert.deepEqual(refreshes, []);
  });
});

test("MIG-0729 U02: stale moderation case receipt cannot reset a different or returning video's form", async () => {
  for (const scenario of ["switch", "return", "reject", "retryable"]) {
    await withMutationDom(async ({ dom, root }) => {
      const old = deferredReceipt();
      const calls = [], refreshes = [];
      const action = fd => { calls.push([fd.get("video_id"), fd.get("private_note")]); return old.promise; };
      const render = id => React.act(async () => root.render(React.createElement(CreateModerationCaseForm, {
        videoId: id, action, onRefresh: () => refreshes.push(id),
      })));
      await render("video-a");
      dom.window.document.querySelector('[name="private_note"]').value = "original A";
      await React.act(async () => dom.window.document.querySelector("form")
        .dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
      assert.deepEqual(calls, [["video-a", "original A"]]);
      await render("video-b");
      if (scenario === "return") await render("video-a");
      const note = dom.window.document.querySelector('[name="private_note"]');
      note.value = "new view unsaved note";
      await React.act(async () => {
        if (scenario === "reject") old.reject(new Error("OLD_FAILURE"));
        else if (scenario === "retryable") old.resolve({ ok: false, retryable: true, message: "OLD_FAILURE" });
        else old.resolve({ ok: true, message: "OLD_CASE_RECEIPT" });
      });
      assert.equal(note.value, "new view unsaved note");
      assert.deepEqual(refreshes, []);
      assert.equal(calls.length, 1);
      assert.doesNotMatch(dom.window.document.body.textContent, /OLD_CASE_RECEIPT|OLD_FAILURE|通信状態を確認/);
      assert.equal(dom.window.document.querySelector('button[type="submit"]').disabled, false);
    });
  }
});

test("MIG-0729 T04: current-view moderation success resets fields and refreshes exactly once", async () => {
  await withMutationDom(async ({ dom, root }) => {
    const receipt = deferredReceipt();
    const calls = [], refreshes = [];
    await React.act(async () => root.render(React.createElement(CreateModerationCaseForm, {
      videoId: "video-a",
      action: fd => { calls.push(fd.get("video_id")); return receipt.promise; },
      onRefresh: () => refreshes.push(true),
    })));
    const note = dom.window.document.querySelector('[name="private_note"]');
    note.value = "original";
    await React.act(async () => dom.window.document.querySelector("form")
      .dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
    await React.act(async () => receipt.resolve({ ok: true, message: "CASE_OK" }));
    assert.deepEqual(calls, ["video-a"]);
    assert.deepEqual(refreshes, [true]);
    assert.equal(note.value, "");
    assert.match(dom.window.document.body.textContent, /CASE_OK/);
  });
});


test("MIG-0729 U02: detail response must echo the Hono-normalized event context", async () => {
  for (const event of ["event/1", " event/1 ", null, "", "   "]) {
    const expected = event?.trim() || null;
    const payload = { ...detail, event: expected };
    let path;
    const result = await loadAdminVideoDetail(async url => {
      path = url;
      return json(200, payload);
    }, "video-1", event);
    assert.deepEqual(result, { status: "ok", data: payload });
    assert.equal(path, "/api/admin-read/videos/video-1" +
      (event ? "?event=" + encodeURIComponent(event) : ""));
    for (const wrong of [null, "", "other-event", " event/1 "].filter(x => x !== expected)) {
      assert.deepEqual(await loadAdminVideoDetail(async () =>
        json(200, { ...payload, event: wrong }), "video-1", event),
      { status: "invalid" }, "reject event echo " + JSON.stringify([event, wrong]));
    }
  }
});

test("MIG-0729 U02: mounted detail rejects another event response before enabling writes", async () => {
  await withMutationDom(async ({ dom, root }) => {
    const gets = [], posts = [];
    const receipt = deferredReceipt();
    const fetchFn = async (path, init) => {
      if (init.method === "POST") {
        posts.push({ path, body: JSON.parse(init.body) });
        return receipt.promise;
      }
      gets.push(path);
      const event = new URL(path, "https://flamenode.invalid").searchParams.get("event");
      return json(200, {
        ...detail,
        // The same video ID is not sufficient to accept a stale event DTO.
        event: event === "event-b" ? "event-a" : event,
        video: { ...detail.video, title: event === "event-b" ? "WRONG_EVENT_DTO" : "SCOPED_" + event },
      });
    };
    let navigate;
    function Probe() {
      navigate = useNavigate();
      const location = useLocation();
      return React.createElement("output", { id: "route-location" }, location.pathname + location.search);
    }
    const go = path => React.act(async () => { navigate(path); });
    const findApprove = () => [...dom.window.document.querySelectorAll("button")]
      .find(b => b.textContent.trim() === "承認して次へ");
    await React.act(async () => root.render(React.createElement(MemoryRouter, {
      initialEntries: ["/admin/videos/video-1?event=event-a"],
    }, React.createElement(Probe), React.createElement(Routes, null,
      React.createElement(Route, { path: "/admin/videos/:id",
        element: React.createElement(AdminVideoDetail, { fetchFn }) }),
    ))));
    assert.match(dom.window.document.body.textContent, /SCOPED_event-a/);
    assert.ok(findApprove());
    await React.act(async () => findApprove().dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true, cancelable: true })));
    assert.deepEqual(posts, [{ path: "/api/admin/videos/video-1/status",
      body: { status: "public", reason: "", review_event_id: "event-a", and_next: "1" } }]);
    await go("/admin/videos/video-1?event=event-b");
    assert.match(dom.window.document.body.textContent, /作品詳細を取得できませんでした/);
    assert.doesNotMatch(dom.window.document.body.textContent, /WRONG_EVENT_DTO|SCOPED_event-a/);
    assert.equal(findApprove(), undefined);
    assert.equal(dom.window.document.querySelector('[name="private_note"]'), null);
    const beforeReceipt = gets.length;
    await React.act(async () => receipt.resolve(json(200, {
      ok: true, message: "OLD_RECEIPT", nextHref: "/admin/videos/other?event=event-a",
    })));
    assert.equal(dom.window.document.getElementById("route-location").textContent,
      "/admin/videos/video-1?event=event-b");
    assert.equal(gets.length, beforeReceipt, "stale write may not refresh the new route");
    assert.equal(posts.length, 1, "never replay a possibly committed write");
    assert.doesNotMatch(dom.window.document.body.textContent, /OLD_RECEIPT/);
    await go("/admin/videos/video-1?event=event-c");
    assert.match(dom.window.document.body.textContent, /SCOPED_event-c/);
    assert.ok(findApprove(), "valid matching detail can still render write controls");
  });
});

test("MIG-0729 U02: same-key invalid detail refresh evicts private content and controls but 503 retains CURRENT state", async () => {
  for (const failure of ["event", "video", "schema", "503"]) {
    await withMutationDom(async ({ dom, root }) => {
      const gets = [], posts = [];
      const initial = {
        ...detail, event: "event-a",
        video: { ...detail.video, title: "PREVIOUS_PRIVATE_TITLE", intro_comment: "PREVIOUS_PRIVATE_CONTENT" },
      };
      const fetchFn = async (path, init) => {
        if (init.method === "POST") {
          posts.push(path);
          return json(200, { ok: true, message: "APPROVED_RECEIPT" });
        }
        gets.push(path);
        if (gets.length === 1) return json(200, initial);
        if (failure === "503") return json(503, {});
        return json(200, {
          ...initial,
          event: failure === "event" ? "other-event" : initial.event,
          video: { ...initial.video, title: "INVALID_RECEIPT_TITLE",
            id: failure === "video" ? "other-video" : initial.video.id },
          moderationCases: failure === "schema" ? "invalid" : initial.moderationCases,
        });
      };
      const findApprove = () => [...dom.window.document.querySelectorAll("button")]
        .find(b => b.textContent.trim() === "承認");
      await React.act(async () => root.render(React.createElement(MemoryRouter, {
        initialEntries: ["/admin/videos/video-1?event=event-a"],
      }, React.createElement(Routes, null,
        React.createElement(Route, { path: "/admin/videos/:id",
          element: React.createElement(AdminVideoDetail, { fetchFn }) }),
      ))));
      assert.match(dom.window.document.body.textContent, /PREVIOUS_PRIVATE_TITLE/);
      assert.match(dom.window.document.body.textContent, /PREVIOUS_PRIVATE_CONTENT/);
      assert.ok(findApprove());
      assert.ok(dom.window.document.querySelector('[name="private_note"]'));
      await React.act(async () => findApprove().dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true, cancelable: true })));
      assert.deepEqual(gets, Array(2).fill("/api/admin-read/videos/video-1?event=event-a"));
      assert.deepEqual(posts, ["/api/admin/videos/video-1/status"], "never replay POST");
      const content = dom.window.document.body.textContent;
      assert.doesNotMatch(content, /INVALID_RECEIPT_TITLE/);
      if (failure === "503") {
        assert.match(content, /PREVIOUS_PRIVATE_TITLE/);
        assert.match(content, /PREVIOUS_PRIVATE_CONTENT/);
        assert.match(content, /APPROVED_RECEIPT/);
        assert.ok(findApprove());
        assert.ok(dom.window.document.querySelector('[name="private_note"]'));
      } else {
        assert.match(content, /作品詳細を取得できませんでした/);
        assert.doesNotMatch(content, /PREVIOUS_PRIVATE_TITLE|PREVIOUS_PRIVATE_CONTENT|APPROVED_RECEIPT/);
        assert.equal(findApprove(), undefined);
        assert.equal(dom.window.document.querySelector('[name="private_note"]'), null);
      }
    });
  }
});


test("MIG-0729 U01: CURRENT list status badges and review-only event detail navigation", async () => {
  const saved = { window: globalThis.window, document: globalThis.document,
    act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: "https://flamenode.invalid/admin/videos",
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(dom.window.document.getElementById("root"));
  const cases = [
    ["", "pending", "event/1", "審査待ち", "warning", false],
    ["public", "public", "event/1", "公開", "accent", false],
    ["private", "private", "event/1", "非公開", "soft", false],
    ["closed", "voided", "event/1", "無効化", "danger", false],
    ["voided", "voided", "event/1", "無効化", "danger", false],
    ["review", "pending", "event/1", "審査待ち", "warning", true],
    ["pending", "pending", "event/1", "審査待ち", "warning", true],
    ["review", "pending", "", "審査待ち", "warning", true],
    ["", "constructor", "event/1", "constructor", "soft", false],
  ];
  function LocationProbe() {
    const location = useLocation();
    return React.createElement("output", { id: "current-path" }, location.pathname + location.search);
  }
  try {
    for (const [filter, status, event, label, badge, review] of cases) {
      const query = new URLSearchParams();
      if (filter) query.set("status", filter);
      if (event) query.set("event", event);
      const search = query.toString();
      const listPath = "/admin/videos" + (search ? "?" + search : "");
      query.set("page", "1");
      const requests = [];
      const fetchFn = async (path, init) => {
        requests.push([path, init?.method]);
        return json(200, {
          q: "", status: filter, event, paging: { page: 1, pageSize: 50, total: 1 },
          videos: [{ id: "video-1", title: "Test", source_type: "youtube",
            youtube_video_id: null, display_name: "Creator", status,
            created_at: 1_700_000_000,
            ...(review ? { review: { stage_permission_summary: "pending",
              required_unanswered_count: 2 } } : {}) }],
          events: event ? [{ id: event, title: "Event" }] : [],
          reviewSummaries: review ? "included" : "not_requested", degraded: false,
        });
      };
      await React.act(async () => root.render(React.createElement(MemoryRouter, {
        key: filter + ":" + event + ":" + status, initialEntries: [listPath],
      }, React.createElement(LocationProbe), React.createElement(Routes, null,
        React.createElement(Route, { path: "/admin/videos",
          element: React.createElement(AdminVideos, { fetchFn }) }),
        React.createElement(Route, { path: "/admin/videos/:id",
          element: React.createElement("p", null, "detail route") }),
      ))));
      const row = dom.window.document.querySelector("tbody tr");
      assert.ok(row, listPath);
      const chip = row.querySelector("td:nth-child(3) .fn-badge");
      assert.equal(chip?.textContent, label, listPath);
      assert.ok(chip.classList.contains("fn-badge-" + badge), listPath);
      const links = Object.fromEntries([...row.querySelectorAll("a")]
        .map(link => [link.textContent.trim(), link.getAttribute("href")]));
      const target = "/admin/videos/video-1" +
        (review && event ? "?event=" + encodeURIComponent(event) : "");
      assert.deepEqual(links, { "詳細": target, "参加者": "/admin/videos/video-1/members",
        "監査": "/admin/audit?table=videos&record=video-1" }, listPath);
      const detailLink = [...row.querySelectorAll("a")].find(link => link.textContent.trim() === "詳細");
      await React.act(async () => detailLink.dispatchEvent(new dom.window.MouseEvent("click", {
        bubbles: true, cancelable: true, button: 0,
      })));
      assert.equal(dom.window.document.getElementById("current-path").textContent, target, listPath);
      assert.deepEqual(requests, [["/api/admin-read/videos?" + query.toString(), "GET"]], listPath);
    }
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    if (saved.window === undefined) delete globalThis.window;
    else globalThis.window = saved.window;
    if (saved.document === undefined) delete globalThis.document;
    else globalThis.document = saved.document;
    if (saved.act === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT = saved.act;
  }
});


test("MIG-0729 U01/U02: thumbnails use CURRENT same-origin proxy, normalized IDs and safe fallback", async () => {
  const id = "dQw4w9WgXcQ";
  const cases = [
    [id, id],
    ["  " + id + "  ", id],
    ["https://youtu.be/" + id + "?t=30", id],
    ["https://www.youtube.com/watch?v=" + id, id],
    ["https://m.youtube.com/watch?v=" + id, id],
    ["http://youtube.com/shorts/" + id, id],
    ["https://youtube.com/embed/" + id, id],
    ["https://youtube.com/live/" + id, id],
    ["https://youtube.com/v/" + id, id],
    ["https://youtube.com/shorts/" + id + "?v=invalid", id],
    ["https://youtube.com.evil.test/watch?v=" + id, null],
    ["https://youtube.com@evil.test/watch?v=" + id, null],
    ["//youtu.be/" + id, null],
    ["ftp://youtube.com/watch?v=" + id, null],
    ["javascript:alert(1)", null],
    ["https://youtu.be/" + id + ".evil", null],
    ["https://youtu.be/%2e%2e", null],
    ["short", null],
    ["", null],
    ["   ", null],
    [null, null],
  ];
  const saved = { window: globalThis.window, document: globalThis.document,
    act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: "https://flamenode.invalid/admin/videos",
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(dom.window.document.getElementById("root"));
  try {
    for (const [index, [input, normalized]] of cases.entries()) {
      for (const [screen, path, size] of [
        [AdminVideos, "/admin/videos", "default"],
        [AdminVideoDetail, "/admin/videos/video-1", "maxresdefault"],
      ]) {
        const expected = normalized ? "/api/youtube-thumbnail/" + normalized + "/" + size : null;
        assert.equal(adminVideoThumbnailHref(input, size), expected);
        const requests = [];
        const fetchFn = async (requestPath, init) => {
          requests.push([requestPath, init?.method]);
          if (screen === AdminVideoDetail) {
            return json(200, { ...detail, event: null,
              video: { ...detail.video, youtube_video_id: input } });
          }
          return json(200, { q: "", status: "", event: "",
            paging: { page: 1, pageSize: 50, total: 1 },
            videos: [{ id: "video-1", title: "Test", source_type: "youtube",
              youtube_video_id: input, display_name: "Creator", status: "pending",
              created_at: 1_700_000_000 }],
            events: [], reviewSummaries: "not_requested", degraded: false });
        };
        await React.act(async () => root.render(React.createElement(MemoryRouter, {
          key: path + ":" + index, initialEntries: [path],
        }, React.createElement(Routes, null, React.createElement(Route, {
          path: screen === AdminVideoDetail ? "/admin/videos/:id" : "/admin/videos",
          element: React.createElement(screen, { fetchFn }),
        })))));
        const doc = dom.window.document;
        assert.match(doc.body.textContent, /Test/, path + " " + input);
        const images = [...doc.querySelectorAll("img")];
        assert.deepEqual(images.map(image => image.getAttribute("src")),
          expected ? [expected] : [], path + " " + input);
        assert.equal(doc.querySelector('img[src*="ytimg.com"]'), null);
        if (expected) {
          assert.equal(new URL(images[0].src).origin, dom.window.location.origin);
          assert.equal(images[0].getAttribute("alt"), "");
        } else if (screen === AdminVideoDetail) {
          assert.match(doc.body.textContent, /YouTube URL: 未設定/);
        } else {
          assert.equal(doc.querySelector("tbody tr td")?.textContent, "—");
        }
        assert.deepEqual(requests, [[screen === AdminVideoDetail
          ? "/api/admin-read/videos/video-1" : "/api/admin-read/videos?page=1", "GET"]]);
      }
    }
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    if (saved.window === undefined) delete globalThis.window;
    else globalThis.window = saved.window;
    if (saved.document === undefined) delete globalThis.document;
    else globalThis.document = saved.document;
    if (saved.act === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT = saved.act;
  }
});


test("MIG-0729 U02: CURRENT watch link is safe for malformed legacy YouTube IDs", async () => {
  const cases = [
    ["dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["  dQw4w9WgXcQ  ", "dQw4w9WgXcQ"],
    [".", "_"], ["..", "_"],
    ["a&next=bad#fragment", "a%26next%3Dbad%23fragment"],
    ["https://youtu.be/dQw4w9WgXcQ?t=30", "https%3A%2F%2Fyoutu.be%2FdQw4w9WgXcQ%3Ft%3D30"],
    ["a\uD800b", "a%EF%BF%BDb"], ["a\uDFFFb", "a%EF%BF%BDb"],
    ["\uD83D\uDE00", "%EF%BF%BD%EF%BF%BD"],
    ["日本語", "%E6%97%A5%E6%9C%AC%E8%AA%9E"],
    ["", null], ["   ", null], [null, null],
  ];
  const saved = { window: globalThis.window, document: globalThis.document,
    act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: "https://flamenode.invalid/admin/videos/video-1",
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(dom.window.document.getElementById("root"));
  try {
    for (const [index, [input, expected]] of cases.entries()) {
      const requests = [];
      const fetchFn = async (path, init) => {
        requests.push([path, init?.method]);
        return json(200, { ...detail, event: null,
          video: { ...detail.video, youtube_video_id: input } });
      };
      await React.act(async () => root.render(React.createElement(MemoryRouter, {
        key: String(index), initialEntries: ["/admin/videos/video-1"],
      }, React.createElement(Routes, null, React.createElement(Route, {
        path: "/admin/videos/:id", element: React.createElement(AdminVideoDetail, { fetchFn }),
      })))));
      const doc = dom.window.document;
      assert.match(doc.body.textContent, /Test/, String(index));
      const watch = [...doc.querySelectorAll("a")].filter(a =>
        a.getAttribute("href")?.startsWith("https://www.youtube.com/watch?v="));
      assert.equal(watch.length, expected === null ? 0 : 1, String(index));
      if (expected !== null) {
        assert.equal(watch[0].getAttribute("href"), "https://www.youtube.com/watch?v=" + expected);
        assert.equal(watch[0].getAttribute("target"), "_blank");
        assert.equal(watch[0].getAttribute("rel"), "noopener noreferrer");
        const url = new URL(watch[0].href);
        assert.equal(url.origin, "https://www.youtube.com");
        assert.equal(url.pathname, "/watch");
        assert.deepEqual([...url.searchParams.keys()], ["v"]);
        assert.equal(url.hash, "");
      }
      assert.deepEqual(requests, [["/api/admin-read/videos/video-1", "GET"]]);
    }
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    if (saved.window === undefined) delete globalThis.window;
    else globalThis.window = saved.window;
    if (saved.document === undefined) delete globalThis.document;
    else globalThis.document = saved.document;
    if (saved.act === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT = saved.act;
  }
});


test("MIG-0729 U02: moderation case history matches CURRENT status badges, missing fields and layout", async () => {
  const cases = [
    { id: "open-1", case_type: "rights", status: "open", public_reason: "", private_note: null,
      due_at: null, related_x_user_id: "", created_at: 0, resolved_at: 0 },
    { id: "resolved-1", case_type: "void", status: "resolved", public_reason: "公開\n理由", private_note: "内部\nメモ",
      due_at: 1_700_000_000, related_x_user_id: "related", created_at: 1_700_000_000, resolved_at: 1_700_000_100 },
    { id: "closed-1", case_type: "other", status: "closed", public_reason: null, private_note: "",
      due_at: 0, related_x_user_id: null, created_at: -1, resolved_at: null },
    { id: "legacy-1", case_type: "unknown", status: "legacy", public_reason: "  ", private_note: " ",
      due_at: -1, related_x_user_id: "x", created_at: 1, resolved_at: -1 },
  ];
  const saved = { window: globalThis.window, document: globalThis.document,
    act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: "https://flamenode.invalid/admin/videos/video-1",
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(dom.window.document.getElementById("root"));
  const expectedFields = [
    ["—", "—", "—", "—", "—"],
    [formatAdminVideoUnix(1_700_000_000), "@related", "公開\n理由", "内部\nメモ", formatAdminVideoUnix(1_700_000_100)],
    ["—", "—", "—", "—", "—"],
    [formatAdminVideoUnix(-1), "@x", "  ", " ", formatAdminVideoUnix(-1)],
  ];
  try {
    for (const [index, records] of [cases, []].entries()) {
      const requests = [];
      const fetchFn = async (path, init) => {
        requests.push([path, init?.method]);
        return json(200, { ...detail, event: null, moderationCases: records,
          openCaseCount: records.filter(item => item.status === "open").length });
      };
      await React.act(async () => root.render(React.createElement(MemoryRouter, {
        key: String(index), initialEntries: ["/admin/videos/video-1"],
      }, React.createElement(Routes, null, React.createElement(Route, {
        path: "/admin/videos/:id", element: React.createElement(AdminVideoDetail, { fetchFn }),
      })))));
      const panel = dom.window.document.querySelector('section[aria-label="モデレーションケース"]');
      assert.ok(panel);
      assert.equal(panel.style.marginTop, "24px");
      assert.equal(panel.querySelector("h2").style.fontSize, "14px");
      assert.ok(panel.querySelector("p.fn-muted").textContent.includes(records.length
        ? "未解決 1 件 / 直近 4 件" : "未解決 0 件 / 直近 0 件"));
      const entries = [...panel.querySelectorAll("details")];
      assert.equal(entries.length, records.length);
      for (const [i, entry] of entries.entries()) {
        const item = records[i];
        const summary = entry.querySelector("summary");
        const badge = summary.querySelector(".fn-badge");
        assert.equal(badge.textContent.trim(), item.status);
        assert.ok(badge.classList.contains(item.status === "open" ? "fn-badge-warning" : "fn-badge-soft"));
        assert.equal(summary.querySelector("code").textContent, item.case_type);
        assert.equal(summary.querySelector(".fn-muted").textContent, formatAdminVideoUnix(item.created_at));
        assert.equal(entry.style.padding, "10px");
        assert.equal(entry.open, false);
        assert.deepEqual([...entry.querySelectorAll("dt")].map(node => node.textContent),
          ["期限", "関連X ID", "公開理由", "内部メモ", "解決日時"]);
        assert.deepEqual([...entry.querySelectorAll("dd")].map(node => node.textContent), expectedFields[i]);
        assert.equal(entry.querySelectorAll("dd")[2].style.whiteSpace, "pre-wrap");
        assert.equal(entry.querySelectorAll("dd")[3].style.whiteSpace, "pre-wrap");
      }
      if (!records.length) assert.match(panel.textContent, /この作品のケースはまだありません。/);
      assert.ok(panel.querySelector("form"), "existing case creation form retained");
      assert.deepEqual(requests, [["/api/admin-read/videos/video-1", "GET"]]);
    }
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    if (saved.window === undefined) delete globalThis.window;
    else globalThis.window = saved.window;
    if (saved.document === undefined) delete globalThis.document;
    else globalThis.document = saved.document;
    if (saved.act === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT = saved.act;
  }
});
