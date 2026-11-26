import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { JSDOM } from "jsdom";
import {
  AdminVideoMembersReadView,
  AdminVideoMembersReadPage,
  currentAdminVideoMembersResult,
} from "../.test-dist/apps/ops/src/routes/admin/AdminVideoMembers.js";

const member = (name, overrides = {}) => ({
  name, x_user_id: "verified_x", role: "作画", comment: "担当",
  order_index: 0, can_edit: 0, is_public_member: 1,
  chapters: [{ time: "1:23", label: "映像", note: "備考" }],
  ...overrides,
});
const snapshot = (id, members = [member("Alice")]) => ({
  video: { id, title: "作品 " + id, youtube_video_id: "yt_id", collaboration_type: "collab" },
  initialMembers: members,
});
const wrap = (node) => React.createElement(MemoryRouter, null, node);
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json" },
});

test("MIG-0730 U02b preview preserves CURRENT public participant/chapter display but has no write controls", () => {
  const html = renderToStaticMarkup(wrap(
    React.createElement(AdminVideoMembersReadView, {
      videoId: "id with space",
      data: snapshot("id with space"),
    }),
  ));
  for (const text of ["作品 id with space", "Alice", "@verified_x", "作画",
    "1:23", "映像", "備考", "合作作品：ON", "閲覧のみ"]) {
    assert.ok(html.includes(text), "expected display: " + text);
  }
  assert.match(html, /\/admin\/videos\/id%20with%20space/);
  assert.doesNotMatch(html, /type="submit"|参加者設定を保存|編集を確定/);
  const empty = renderToStaticMarkup(wrap(
    React.createElement(AdminVideoMembersReadView, {
      videoId: "empty",
      data: { ...snapshot("empty", []), video: { ...snapshot("empty").video, collaboration_type: null } },
    }),
  ));
  assert.match(empty, /合作作品：OFF/);
  assert.match(empty, /公開参加者は登録されていません/);
});

test("MIG-0730 U02ce: CURRENT member footer links stay same-origin and retain safe public fallbacks", () => {
  const youtube = "dQw4w9WgXcQ";
  const scenarios = [
    { id: "safe_slug", youtubeId: youtube, expected: "/" + youtube },
    { id: "safe_slug", youtubeId: "https://youtu.be/" + youtube + "?t=30", expected: "/" + youtube },
    { id: "safe_slug", youtubeId: "https://www.youtube.com/watch?v=" + youtube, expected: "/" + youtube },
    { id: "safe_slug", youtubeId: "https://youtube.com/shorts/" + youtube, expected: "/" + youtube },
    { id: "safe_slug", youtubeId: "https://youtube.com.evil.test/watch?v=" + youtube, expected: "/safe_slug" },
    { id: "safe_slug", youtubeId: "//evil.test/path", expected: "/safe_slug" },
    { id: "safe_slug", youtubeId: null, expected: "/safe_slug" },
    { id: "id with space", youtubeId: "invalid-id", expected: "/list" },
  ];
  for (const { id, youtubeId, expected } of scenarios) {
    const data = snapshot(id);
    data.video.youtube_video_id = youtubeId;
    const html = renderToStaticMarkup(wrap(React.createElement(AdminVideoMembersReadView, {
      videoId: id, data,
    })));
    const doc = new JSDOM(html).window.document;
    const links = [...doc.querySelectorAll("a")];
    const detail = links.find(link => link.textContent.trim() === "詳細へ戻る");
    const publicLink = links.find(link => link.textContent.trim() === "公開ページ");
    assert.ok(detail, "CURRENT detail footer exists");
    assert.equal(detail.getAttribute("href"), "/admin/videos/" + encodeURIComponent(id));
    assert.ok(publicLink, "CURRENT public footer exists");
    assert.equal(publicLink.getAttribute("href"), expected,
      "YouTube and invalid legacy identifiers use CURRENT safe same-origin URLs");
    assert.equal(publicLink.getAttribute("target"), "_blank");
    assert.equal(publicLink.getAttribute("rel"), "noopener noreferrer");
    assert.doesNotMatch(html, /type="submit"|参加者設定を保存/);
  }
});

test("MIG-0730 U02b render-time identity epoch prevents A-B-A private data reuse", () => {
  const fetchFn = async () => json(snapshot("a"));
  const previous = {
    videoId: "a", fetchFn, epoch: 7,
    result: { status: "ok", data: snapshot("a", [member("OLD_PRIVATE_A")]) },
  };
  assert.equal(currentAdminVideoMembersResult("a", fetchFn, 7, previous), previous.result);
  assert.equal(currentAdminVideoMembersResult("b", fetchFn, 8, previous), null);
  assert.equal(currentAdminVideoMembersResult("a", fetchFn, 9, previous), null,
    "a return to the same video ID must not resurrect prior authorized data");
  assert.equal(currentAdminVideoMembersResult("a", () => json(snapshot("a")), 7, previous), null);
});

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://flamenode.test/admin/videos/a/members",
});
for (const key of ["window", "document", "navigator", "HTMLElement", "Node"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function deferred() {
  let resolve;
  return { promise: new Promise(done => { resolve = done; }), resolve: (v) => resolve(v) };
}
function setup(managementTabs) {
  const target = document.createElement("div");
  document.body.append(target);
  const root = createRoot(target);
  const calls = [];
  const navigations = [];
  const onNavigate = path => navigations.push(path);
  const fetchFn = (url, init) => {
    const wait = deferred();
    calls.push({ ...wait, url, signal: init?.signal });
    return wait.promise;
  };
  const render = async (videoId, activeFetch = fetchFn, authorityEpoch) => React.act(async () => {
    root.render(wrap(React.createElement(AdminVideoMembersReadPage, {
      videoId, fetchFn: activeFetch, onNavigate, managementTabs, authorityEpoch,
    })));
  });
  const cleanup = async () => React.act(async () => { root.unmount(); target.remove(); });
  return { target, calls, render, cleanup, navigations };
}

test("MIG-0730 U02b already displayed private video A data disappears immediately on B navigation", async () => {
  const ui = setup();
  try {
    await ui.render("a");
    assert.match(ui.target.textContent, /読み込み中/);
    await React.act(async () => { ui.calls[0].resolve(json(snapshot("a", [member("PRIVATE_A")]))); });
    assert.match(ui.target.textContent, /PRIVATE_A/);

    await ui.render("b");
    assert.equal(ui.calls[0].signal.aborted, true);
    assert.doesNotMatch(ui.target.textContent, /PRIVATE_A/);
    assert.match(ui.target.textContent, /読み込み中/);
    await React.act(async () => { ui.calls[1].resolve(json(snapshot("b", [member("PRIVATE_B")]))); });
    assert.match(ui.target.textContent, /PRIVATE_B/);
    assert.doesNotMatch(ui.target.textContent, /PRIVATE_A/);
  } finally { await ui.cleanup(); }
});

test("MIG-0730 U02cd: same-video fetch adapter rotation hides an old authorized snapshot", async () => {
  const ui = setup();
  const rotatedCalls = [];
  const rotatedFetch = (url, init) => {
    const wait = deferred();
    rotatedCalls.push({ ...wait, url, signal: init?.signal });
    return wait.promise;
  };
  try {
    await ui.render("a");
    await React.act(async () => ui.calls[0].resolve(json(snapshot("a", [member("OLD_SCOPE_PRIVATE")]))));
    assert.match(ui.target.textContent, /OLD_SCOPE_PRIVATE/);

    // Even when the URL is unchanged, a new fetch port may represent a new
    // session/authorization scope. The previous private snapshot must vanish.
    await ui.render("a", rotatedFetch);
    assert.equal(ui.calls[0].signal.aborted, true);
    assert.equal(rotatedCalls.length, 1, "new fetch port requires its own GET");
    assert.match(ui.target.textContent, /読み込み中/);
    assert.doesNotMatch(ui.target.textContent, /OLD_SCOPE_PRIVATE/,
      "render-time identity invalidation must not wait for the new GET");

    await React.act(async () => rotatedCalls[0].resolve(json(snapshot("a", [member("NEW_SCOPE_MEMBER")]))));
    assert.match(ui.target.textContent, /NEW_SCOPE_MEMBER/);
    assert.doesNotMatch(ui.target.textContent, /OLD_SCOPE_PRIVATE/);
    assert.deepEqual(ui.navigations, [], "a same-video adapter swap never redirects");
  } finally { await ui.cleanup(); }
});

test("MIG-0730 U02b 403 and obsolete aborted response cannot re-display private participant data", async () => {
  const ui = setup();
  try {
    await ui.render("a");
    await ui.render("b");
    assert.equal(ui.calls[0].signal.aborted, true);
    await React.act(async () => { ui.calls[0].resolve(json(snapshot("a", [member("PRIVATE_A")]))); });
    assert.doesNotMatch(ui.target.textContent, /PRIVATE_A/);
    await React.act(async () => { ui.calls[1].resolve(json({ reason: "forbidden" }, 403)); });
    assert.match(ui.target.textContent, /権限がありません/);
    assert.doesNotMatch(ui.target.textContent, /PRIVATE_A/);
  } finally { await ui.cleanup(); }
});

test("MIG-0730 U02ca: 401 and admin-read 403 redirect, while 404 does not navigate", async () => {
  const ui = setup();
  try {
    await ui.render("a");
    await React.act(async () => ui.calls[0].resolve(json({ error: "unauthorized" }, 401)));
    assert.deepEqual(ui.navigations, ["/entry"], "401 sends the operator to login");
    assert.doesNotMatch(ui.target.textContent, /Alice|PRIVATE/);

    await ui.render("b");
    await React.act(async () => ui.calls[1].resolve(json({ redirect: "/dashboard" }, 403)));
    assert.deepEqual(ui.navigations, ["/entry", "/dashboard"],
      "admin-read 403 returns to the authorized dashboard");

    await ui.render("c");
    await React.act(async () => ui.calls[2].resolve(json({ redirect: "/entry" }, 403)));
    assert.deepEqual(ui.navigations, ["/entry", "/dashboard", "/dashboard"],
      "generic allowed redirects cannot change the admin-read 403 target");

    await ui.render("d");
    await React.act(async () => ui.calls[3].resolve(json({}, 404)));
    assert.deepEqual(ui.navigations, ["/entry", "/dashboard", "/dashboard"],
      "404 is not an auth redirect");
    assert.match(ui.target.textContent, /ページが見つかりません/,
      "D-17-2 uses the shared CURRENT 404 view instead of a local alert");
    assert.match(ui.target.textContent, /トップへ戻る/,
      "shared 404 view includes the standard recovery action");
    assert.equal(ui.target.querySelector('a[href="/"]')?.textContent, "トップへ戻る");
  } finally { await ui.cleanup(); }
});

test("MIG-0730 U02ca: an obsolete A authorization error cannot redirect video B", async () => {
  const ui = setup();
  try {
    await ui.render("a");
    await ui.render("b");
    assert.equal(ui.calls[0].signal.aborted, true);
    await React.act(async () => ui.calls[0].resolve(json({ redirect: "/dashboard" }, 403)));
    assert.deepEqual(ui.navigations, [], "stale A must not redirect B");
    await React.act(async () => ui.calls[1].resolve(json(snapshot("b"))));
    assert.deepEqual(ui.navigations, [], "authorized B never redirects");
    assert.match(ui.target.textContent, /作品 b/);
  } finally { await ui.cleanup(); }
});

test("MIG-0730 U02cc: obsolete 404 cannot replace video B or reappear on A revisit", async () => {
  const ui = setup();
  try {
    await ui.render("a");
    await ui.render("b");
    assert.equal(ui.calls[0].signal.aborted, true, "A request is cancelled on navigation");
    await React.act(async () => ui.calls[1].resolve(json(snapshot("b", [member("CURRENT_B")]))));
    assert.match(ui.target.textContent, /CURRENT_B/);

    await React.act(async () => ui.calls[0].resolve(json({}, 404)));
    assert.match(ui.target.textContent, /CURRENT_B/, "stale A 404 must not displace B");
    assert.doesNotMatch(ui.target.textContent, /ページが見つかりません/,
      "stale A 404 must not mount the shared NotFoundView");
    assert.deepEqual(ui.navigations, [], "404 is never an auth redirect");

    await ui.render("a");
    assert.equal(ui.calls[1].signal.aborted, true);
    assert.match(ui.target.textContent, /読み込み中/);
    assert.doesNotMatch(ui.target.textContent, /CURRENT_B|ページが見つかりません/);
    await React.act(async () => ui.calls[2].resolve(json(snapshot("a", [member("FRESH_A")]))));
    assert.match(ui.target.textContent, /FRESH_A/);
    assert.doesNotMatch(ui.target.textContent, /CURRENT_B|ページが見つかりません/);
  } finally { await ui.cleanup(); }
});

test("MIG-0730 U02b invalid UTF-16 route ID fails without any network and no endless loading", async () => {
  const ui = setup();
  try {
    await ui.render("\uD800");
    assert.equal(ui.calls.length, 0);
    assert.match(ui.target.textContent, /取得できませんでした/);
    assert.doesNotMatch(ui.target.textContent, /読み込み中/);
  } finally { await ui.cleanup(); }
});

test("MIG-0730 U02cl: direct read view rejects throwing injected DTO getters without crashing", () => {
  const topLevel = { video: snapshot("v1").video,
    get initialMembers() { throw new Error("PRIVATE_TOP_LEVEL"); } };
  const nested = snapshot("v1", [member("PRIVATE_NESTED")]);
  Object.defineProperty(nested.initialMembers[0], "name", {
    enumerable: true,
    get() { throw new Error("PRIVATE_NESTED_GETTER"); },
  });
  const revoked = Proxy.revocable(snapshot("v1", [member("PRIVATE_PROXY")]), {});
  revoked.revoke();
  for (const input of [topLevel, nested, revoked.proxy]) {
    const markup = renderToStaticMarkup(wrap(React.createElement(AdminVideoMembersReadView, {
      videoId: "v1", data: input,
    })));
    assert.match(markup, /参加者データを表示できません/, "fail closed without a render exception");
    assert.doesNotMatch(markup, /PRIVATE_|公開参加者（|公開ページ|type="submit"/,
      "private member rows and authorized links must not render");
  }
});

test("MIG-0730 U02m: read view fails closed on injected private or wrong-video DTO, never renders secret", () => {
  for (const injected of [
    snapshot("other", [member("PRIVATE_OTHER")]),
    snapshot("v1", [member("HIDDEN_MEMBER", { is_public_member: 0 })]),
    snapshot("v1", [member("INVALID_MEMBER", { chapters: [{ time: 12, label: "Bad", note: "" }] })]),
    { ...snapshot("v1"), initialMembers: null },
  ]) {
    const html = renderToStaticMarkup(wrap(React.createElement(AdminVideoMembersReadView, {
      videoId: "v1", data: injected,
    })));
    assert.match(html, /参加者データを表示できません/);
    assert.doesNotMatch(html, /PRIVATE_OTHER|HIDDEN_MEMBER|INVALID_MEMBER|type="submit"/);
  }
});

test("MIG-0730 U02m: read view rejects 101 rows before any nested member getter runs", () => {
  let touched = 0;
  const many = Array.from({ length: 101 }, (_, i) => member("User " + i));
  Object.defineProperty(many, 0, {
    configurable: true, enumerable: true,
    get() { touched++; throw new Error("oversized private rows must not be traversed"); },
  });
  const html = renderToStaticMarkup(wrap(React.createElement(AdminVideoMembersReadView, {
    videoId: "v1", data: snapshot("v1", many),
  })));
  assert.equal(touched, 0);
  assert.match(html, /参加者データを表示できません/);
  assert.doesNotMatch(html, /User 100/);
});


test("MIG-0730 U02n: direct read view rejects malformed route IDs without rendering participants or throwing", () => {
  const badIds = [
    "", ".", "..", "v/child", "v\\child", " leading", "trailing ",
    "v\0tail", "v\nchild", "\uD800", "v".repeat(65),
  ];
  for (const id of badIds) {
    const html = renderToStaticMarkup(wrap(React.createElement(AdminVideoMembersReadView, {
      videoId: id, data: snapshot(id, [member("NONPUBLIC_ROWHOLDER")]),
    })));
    assert.match(html, /参加者データを表示できません/, "invalid route must fail closed");
    assert.doesNotMatch(html, /NONPUBLIC_ROWHOLDER|公開参加者（/);
  }
});

test("MIG-0730 U02n: invalid route short-circuits before reading untrusted member getters", () => {
  let accessed = 0;
  const forged = {
    get initialMembers() {
      accessed++;
      throw Error("untrusted participant getter must not be evaluated");
    },
  };
  const html = renderToStaticMarkup(wrap(React.createElement(AdminVideoMembersReadView, {
    videoId: "../other", data: forged,
  })));
  assert.equal(accessed, 0);
  assert.match(html, /参加者データを表示できません/);
});

test("MIG-0730 U02cz: read-only SSR uses only the bounded member snapshot", () => {
  const first = [member("Visible first")];
  const oversized = Array.from({ length: 101 }, () => member("PRIVATE_ROW"));
  let traversed = 0;
  Object.defineProperty(oversized, 0, {
    get() { traversed++; throw Error("PRIVATE_ROW_ACCESS"); },
  });
  const data = snapshot("v1", first);
  let reads = 0;
  Object.defineProperty(data, "initialMembers", {
    get() { reads++; return reads === 1 ? first : oversized; },
  });
  const markup = renderToStaticMarkup(wrap(
    React.createElement(AdminVideoMembersReadView, { videoId: "v1", data }),
  ));
  assert.match(markup, /Visible first/);
  assert.doesNotMatch(markup, /PRIVATE_ROW/);
  assert.equal(reads, 1);
  assert.equal(traversed, 0);
});

test("MIG-0730 U02dm: MIG-0729 tabs integration receives only authorized video metadata", () => {
  const calls = [];
  const FakeAdminVideoTabs = props => {
    calls.push(props);
    return React.createElement("nav", { "aria-label": "作品管理メニュー",
      "data-active": props.active, "data-video": props.videoId },
      React.createElement("span", null, "6-tab seam"));
  };
  const videoId = "v1";
  const accepted = snapshot(videoId);
  accepted.video.youtube_video_id = "dQw4w9WgXcQ";
  const validMarkup = renderToStaticMarkup(wrap(React.createElement(AdminVideoMembersReadView, {
    videoId, data: accepted, managementTabs: FakeAdminVideoTabs,
  })));
  assert.match(validMarkup, /6-tab seam/);
  assert.match(validMarkup, /data-active="members"/);
  assert.match(validMarkup, /data-video="v1"/);
  assert.deepEqual(calls, [{
    videoId: "v1", youtubeVideoId: "dQw4w9WgXcQ", active: "members",
  }], "MIG-0729 AdminVideoTabs receives exactly its current public props shape");

  for (const blocked of [
    { videoId: "other", data: accepted },
    { videoId: "v1", data: snapshot("v1", [member("PRIVATE_ROW", { is_public_member: 0 })]) },
    { videoId: "v1", data: snapshot("v1", Array.from({ length: 101 }, () => member("PRIVATE_ROW"))) },
  ]) {
    const markup = renderToStaticMarkup(wrap(React.createElement(AdminVideoMembersReadView, {
      ...blocked, managementTabs: FakeAdminVideoTabs,
    })));
    assert.match(markup, /参加者データを表示できません/);
    assert.doesNotMatch(markup, /6-tab seam|PRIVATE_ROW|data-active/);
  }
  assert.equal(calls.length, 1, "no navigation component mounts for mismatched, hidden or oversized DTO");
  const inert = renderToStaticMarkup(wrap(React.createElement(AdminVideoMembersReadView, {
    videoId, data: accepted, managementTabs: { forged: true },
  })));
  assert.doesNotMatch(inert, /6-tab seam/,
    "malformed injected component cannot enable navigation or writes");
});

test("MIG-0730 U02dm: page mounts six-tab seam only after current authorized GET", async () => {
  const calls = [];
  function FakeAdminVideoTabs(props) {
    calls.push({ ...props });
    return React.createElement("nav", { "aria-label": "作品管理メニュー",
      "data-target": props.videoId }, "Tabs for " + props.videoId);
  }
  const ui = setup(FakeAdminVideoTabs);
  try {
    await ui.render("a");
    assert.equal(calls.length, 0, "loading private GET never mounts tabs");
    await React.act(async () => ui.calls[0].resolve(json(snapshot("a"))));
    assert.equal(ui.target.querySelector("nav")?.getAttribute("data-target"), "a");
    assert.deepEqual(calls.map(x => x.videoId), ["a"]);

    await ui.render("b");
    assert.equal(ui.target.querySelector("nav"), null,
      "old video navigation disappears immediately on A to B");
    await React.act(async () => ui.calls[1].resolve(json({ error: "forbidden" }, 403)));
    assert.equal(ui.target.querySelector("nav"), null,
      "forbidden response never mounts a tab with private metadata");
    assert.deepEqual(calls.map(x => x.videoId), ["a"]);

    await ui.render("c");
    await React.act(async () => ui.calls[2].resolve(json(snapshot("c"))));
    assert.equal(ui.target.querySelector("nav")?.getAttribute("data-target"), "c");
    assert.deepEqual(calls.map(x => x.videoId), ["a", "c"]);
    assert.deepEqual(calls.map(x => x.active), ["members", "members"]);
  } finally { await ui.cleanup(); }
});


test("MIG-0730 U02dr: same-video committed authority rotation hides old participants and tabs before fresh GET", async () => {
  const tabs = [];
  function Tabs(props) {
    tabs.push(props.videoId);
    return React.createElement("nav", { "aria-label": "作品管理メニュー" }, props.videoId);
  }
  const ui = setup(Tabs);
  try {
    await ui.render("a", undefined, 1);
    await React.act(async () => ui.calls[0].resolve(json(snapshot("a", [member("OLD_AUTHORITY")] ))));
    assert.match(ui.target.textContent, /OLD_AUTHORITY/);
    assert.ok(ui.target.querySelector("nav"));
    await ui.render("a", undefined, 1);
    assert.equal(ui.calls.length, 1, "stable authority and transport keep the current read");
    assert.match(ui.target.textContent, /OLD_AUTHORITY/);
    const tabsBeforeRotation = tabs.length;

    await ui.render("a", undefined, 2);
    assert.equal(ui.calls[0].signal.aborted, true);
    assert.equal(ui.calls.length, 2);
    assert.equal(ui.calls[0].url, ui.calls[1].url, "video and transport path stay identical");
    assert.match(ui.target.textContent, /読み込み中/);
    assert.doesNotMatch(ui.target.textContent, /OLD_AUTHORITY/);
    assert.equal(ui.target.querySelector("nav"), null);
    assert.equal(tabs.length, tabsBeforeRotation, "loading does not render stale management tabs");

    await React.act(async () => ui.calls[1].resolve(json(snapshot("a", [member("NEW_AUTHORITY")] ))));
    assert.match(ui.target.textContent, /NEW_AUTHORITY/);
    assert.doesNotMatch(ui.target.textContent, /OLD_AUTHORITY/);
    assert.ok(ui.target.querySelector("nav"));
    assert.deepEqual(ui.navigations, []);
  } finally { await ui.cleanup(); }
});

test("MIG-0730 U02dr: same-video A-B-A ignores previous authority's delayed success or denial", async () => {
  for (const status of [200, 401, 403, 404]) {
    const ui = setup();
    try {
      await ui.render("a", undefined, 1);
      await ui.render("a", undefined, 2);
      await ui.render("a", undefined, 3);
      assert.equal(ui.calls.length, 3);
      assert.equal(ui.calls[0].signal.aborted, true);
      assert.equal(ui.calls[1].signal.aborted, true);
      assert.equal(ui.calls[2].signal.aborted, false);
      const late = status === 200
        ? json(snapshot("a", [member("STALE_AUTHORITY")]))
        : json({ redirect: "/dashboard" }, status);
      await React.act(async () => ui.calls[0].resolve(late));
      assert.match(ui.target.textContent, /読み込み中/);
      assert.deepEqual(ui.navigations, []);
      await React.act(async () => ui.calls[2].resolve(json(snapshot("a", [member("FRESH_AUTHORITY")]))));
      await React.act(async () => ui.calls[1].resolve(json(snapshot("a", [member("STALE_AUTHORITY")]))));
      assert.match(ui.target.textContent, /FRESH_AUTHORITY/);
      assert.doesNotMatch(ui.target.textContent, /STALE_AUTHORITY/);
      assert.deepEqual(ui.navigations, []);
    } finally { await ui.cleanup(); }
  }
});

test("MIG-0730 U02dr: malformed host authority retires private read without network and reentry loads fresh", async () => {
  const ui = setup();
  try {
    await ui.render("a", undefined, 1);
    await React.act(async () => ui.calls[0].resolve(json(snapshot("a", [member("OLD_AUTHORITY")]))));
    assert.match(ui.target.textContent, /OLD_AUTHORITY/);
    for (const value of [null, "1", NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await ui.render("a", undefined, value);
      assert.match(ui.target.textContent, /参加者データを表示できません/);
      assert.doesNotMatch(ui.target.textContent, /OLD_AUTHORITY/);
      assert.equal(ui.calls.length, 1, "invalid supplied epoch must not start a GET");
    }
    assert.equal(ui.calls[0].signal.aborted, true);
    await ui.render("a", undefined, 1);
    assert.equal(ui.calls.length, 2, "reentry after invalid authority requires a fresh GET");
    assert.match(ui.target.textContent, /読み込み中/);
    assert.doesNotMatch(ui.target.textContent, /OLD_AUTHORITY/);
    await React.act(async () => ui.calls[1].resolve(json({}, 403)));
    assert.deepEqual(ui.navigations, ["/dashboard"], "current denial still follows CURRENT navigation");
  } finally { await ui.cleanup(); }
});
