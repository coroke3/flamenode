// MIG-0725 U03b/U03c: read-only production candidate; injected review UI tests, no live API.
import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { JSDOM } from "jsdom";
import {
  ManageXLinkRequestsBody, ManageXLinkRequestsView, xLinkRequestRedirect,
} from "../.test-dist/apps/ops/src/routes/manage/ManageXLinkRequests.js";

const h = (type, props, ...children) => React.createElement(type, props, ...children);
const render = (element) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ["/manage/x-link-requests"] }, element));
const row = {
  id: "req/1", requested_x_id: "alice", requested_by_auth_user_id: "account1",
  discord_name: "Discord Staff", discord_image: null, requested_at: 1_700_000_000,
  request_type: "new_link", target_x_user_id: null, requested_x_name: "Alice",
  requested_icon_url: "https://static.example/avatar.png", requested_approval_status: "pending",
  target_icon_url: null, target_approval_status: null,
};

test("U03b pending queue retains CURRENT fields and never shows unverified mutation buttons", () => {
  const html = render(h(ManageXLinkRequestsBody, { data: { rows: [row] } }));
  const doc = new JSDOM(html).window.document;
  assert.match(html, /X ID 申請/);
  assert.match(html, /1件/);
  assert.match(html, /Discord Staff/);
  assert.match(html, /account1/);
  assert.match(html, /req\/1/);
  assert.match(html, /X ID連携/);
  assert.ok(doc.querySelector('a[href="https://x.com/alice"]'));
  assert.ok(doc.querySelector('a[href="/user/alice"]'));
  assert.ok(doc.querySelector('a[href="/manage"]'));
  assert.equal(doc.querySelectorAll("tbody tr").length, 1);
  assert.ok(doc.querySelector('img.x-link-request-avatar[src="https://static.example/avatar.png"]'));
  assert.ok(doc.querySelector(".x-link-request-avatar"));
  assert.equal(doc.querySelectorAll("button").length, 0);
  assert.doesNotMatch(html, /理由を添えて却下|処理しました/);
});

test("U03b empty, owner-denied and unavailable states do not leak private request rows", () => {
  const empty = render(h(ManageXLinkRequestsBody, { data: { rows: [] } }));
  assert.match(empty, /承認待ちの X ID 連携申請はありません/);
  for (const status of ["loading", "anonymous", "forbidden", "notFound", "unavailable", "unsupported"]) {
    const data = status === "forbidden" ? { status, reason: "manage_access_required" } : { status };
    const html = render(h(ManageXLinkRequestsView, { data }));
    assert.doesNotMatch(html, /account1|Discord Staff|req\/1/);
  }
  assert.match(render(h(ManageXLinkRequestsView, { data: { status: "notFound" } })), /ページが見つかりません/);
  assert.equal(xLinkRequestRedirect({ status: "anonymous" }), "/entry?next=%2Fmanage%2Fx-link-requests");
  assert.equal(xLinkRequestRedirect({ status: "forbidden", reason: "manage_access_required" }), "/dashboard");
  assert.equal(xLinkRequestRedirect({ status: "forbidden" }), "/entry?error=auth_temporarily_unavailable");
  assert.equal(xLinkRequestRedirect({ status: "notFound" }), null);
});

test("U03b unsafe icon URL, hostile text and invalid Unix range cannot inject HTML or crash", () => {
  const html = render(h(ManageXLinkRequestsBody, { data: { rows: [{
    ...row, id: "<script>alert(1)</script>", requested_x_id: "evil\" onerror=\"x",
    requested_x_name: "<img src=x onerror=alert(1)>", discord_name: "<script>bad()</script>",
    discord_image: "javascript:alert(1)", requested_icon_url: "data:image/svg+xml;base64,evil",
    target_x_user_id: "target", target_icon_url: "//evil.invalid/a",
    requested_at: Number.MAX_VALUE, request_type: "constructor",
  }] } }));
  const doc = new JSDOM(html).window.document;
  assert.equal(doc.querySelectorAll("script").length, 0);
  assert.equal(doc.querySelectorAll('img[src^="javascript:"]').length, 0);
  assert.equal(doc.querySelectorAll('img[src^="data:"]').length, 0);
  assert.equal(doc.querySelectorAll('img[src^="//"]').length, 0);
  assert.equal(doc.querySelectorAll("button").length, 0);
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.match(html, /constructor/);
  assert.ok(doc.querySelector("tbody")?.textContent.includes("—"));
  assert.ok(doc.querySelector('a[href^="https://x.com/"]'));
});

test("U03b shared avatar uses Google Drive cache and a text fallback for invalid icons", () => {
  const valid = render(h(ManageXLinkRequestsBody, { data: { rows: [{
    ...row, requested_icon_url: "https://drive.google.com/file/d/abcDEF012/view",
  }] } }));
  const validDoc = new JSDOM(valid).window.document;
  assert.ok(validDoc.querySelector('img.x-link-request-avatar[src="/api/google-drive-image/abcDEF012"]'));

  const invalid = render(h(ManageXLinkRequestsBody, { data: { rows: [{
    ...row, requested_icon_url: "javascript:alert(1)", requested_x_name: null,
  }] } }));
  const invalidDoc = new JSDOM(invalid).window.document;
  assert.equal(invalidDoc.querySelectorAll("img.x-link-request-avatar").length, 0);
  assert.match(invalidDoc.querySelector(".x-link-request-avatar-fallback")?.textContent ?? "", /A/);
});


test("U03b rejects backslash network-path URLs and malformed HTTPS for both X and Discord images", () => {
  for (const dangerous of [
    "/\\evil.invalid/avatar.png",
    "/\\\\evil.invalid/avatar.png",
    "https:\\evil.invalid/avatar.png",
    "https://",
    "https://user:secret@evil.invalid/a",
    "/safe\\path",
    "https://example.com/a\\b",
    "\nhttps://example.com/a",
  ]) {
    const html = render(h(ManageXLinkRequestsBody, { data: { rows: [{
      ...row, requested_icon_url: dangerous, discord_image: dangerous,
    }] } }));
    const doc = new JSDOM(html).window.document;
    assert.equal(doc.querySelectorAll("img.x-link-request-avatar").length, 0, dangerous);
    assert.equal(doc.querySelectorAll("td:nth-child(4) img").length, 0, dangerous);
    assert.ok(doc.querySelector(".x-link-request-avatar-fallback"), dangerous);
  }
  const safe = render(h(ManageXLinkRequestsBody, { data: { rows: [{
    ...row, requested_icon_url: "/api/manage-x-icons/signed?a=1",
    discord_image: "https://cdn.example/avatar.webp",
  }] } }));
  const doc = new JSDOM(safe).window.document;
  assert.ok(doc.querySelector('img.x-link-request-avatar[src="/api/manage-x-icons/signed?a=1"]'));
  assert.ok(doc.querySelector('td:nth-child(4) img[src="https://cdn.example/avatar.webp"]'));
});


const success = { status: "ok", data: { ok: true } };
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const reviewAdapter = (overrides = {}) => ({
  approve: async () => success,
  reject: async () => success,
  onRefresh: () => {},
  onAnonymous: () => {},
  ...overrides,
});

async function withReviewBody(actions, run, rows = [row, { ...row, id: "req/2" }]) {
  const dom = new JSDOM('<div id="root"></div>', {
    url: "https://flamenode.test/manage/x-link-requests", pretendToBeVisual: true,
  });
  const keys = ["window", "document", "navigator", "HTMLElement", "HTMLTextAreaElement", "Node", "Event", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of keys) Object.defineProperty(globalThis, key, {
    configurable: true, writable: true,
    value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? dom.window : dom.window[key],
  });
  const node = dom.window.document.getElementById("root");
  let root;
  try {
    const { createRoot } = await import("react-dom/client");
    root = createRoot(node);
    const draw = (adapter, nextRows = rows) => React.act(async () => root.render(
      h(MemoryRouter, { initialEntries: ["/manage/x-link-requests"] },
        h(ManageXLinkRequestsBody, { data: { rows: nextRows }, reviewActions: adapter })),
    ));
    await draw(actions);
    await run({ node, dom, draw, unmount: async () => {
      if (root) { await React.act(async () => root.unmount()); root = undefined; }
    } });
  } finally {
    try { if (root) await React.act(async () => root.unmount()); }
    finally {
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
      dom.window.close();
    }
  }
}
const button = (node, label, rowIndex = 0) => [...node.querySelectorAll("tbody tr")[rowIndex].querySelectorAll("button")]
  .find(item => item.textContent === label);

test("U03c injected review controls allow only link requests; no default live write", () => {
  const data = { rows: [row, { ...row, id: "merge", request_type: "merge" },
    { ...row, id: "existing", request_type: "existing_link" }] };
  const doc = new JSDOM(render(h(ManageXLinkRequestsBody, { data, reviewActions: reviewAdapter() }))).window.document;
  assert.equal(doc.querySelectorAll("tbody tr")[0].querySelectorAll("button").length, 2);
  assert.equal(doc.querySelectorAll("tbody tr")[1].querySelectorAll("button").length, 0);
  assert.equal(doc.querySelectorAll("tbody tr")[2].querySelectorAll("button").length, 2);
  const defaultView = new JSDOM(render(h(ManageXLinkRequestsView, { data: { status: "ok", data } }))).window.document;
  assert.equal(defaultView.querySelectorAll("button").length, 0);
});

test("U03c T05: synchronous queue-wide single flight, one success refresh and no replay of acknowledged request", async () => {
  const receipt = deferred();
  const calls = [];
  let refreshes = 0;
  const actions = reviewAdapter({
    approve: (id) => { calls.push(["approve", id]); return receipt.promise; },
    reject: async (id, reason) => { calls.push(["reject", id, reason]); return success; },
    onRefresh: () => { refreshes++; },
  });
  await withReviewBody(actions, async ({ node }) => {
    await React.act(async () => {
      button(node, "承認").click();
      button(node, "承認").click();
      button(node, "承認", 1).click();
    });
    assert.deepEqual(calls, [["approve", "req/1"]]);
    assert.equal([...node.querySelectorAll("tbody button")].every(item => item.disabled), true);
    await React.act(async () => receipt.resolve(success));
    assert.equal(refreshes, 1);
    assert.match(node.querySelector('[role="status"]').textContent, /処理しました/);
    assert.equal(button(node, "承認").disabled, true);
    assert.equal(button(node, "却下").disabled, true);
    assert.equal(button(node, "承認", 1).disabled, false);
    await React.act(async () => button(node, "承認").click());
    assert.equal(calls.length, 1);
  });
});

test("U03c T06: capped reason, failure retains edit, cancel resets and success refreshes", async () => {
  const calls = [];
  let refreshes = 0;
  const actions = reviewAdapter({
    reject: async (id, reason) => {
      calls.push([id, reason]);
      return calls.length === 1 ? { status: "ok", data: { ok: false, message: "再確認してください。" } } : success;
    },
    onRefresh: () => { refreshes++; },
  });
  await withReviewBody(actions, async ({ node, dom }) => {
    await React.act(async () => button(node, "却下").click());
    const input = node.querySelector("textarea");
    assert.equal(input.maxLength, 500);
    await React.act(async () => {
      const set = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value").set;
      set.call(input, "あ".repeat(501));
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    assert.equal(input.value, "あ".repeat(500));
    await React.act(async () => button(node, "理由を添えて却下").click());
    assert.deepEqual(calls, [["req/1", "あ".repeat(500)]]);
    assert.equal(refreshes, 0);
    assert.equal(node.querySelector("textarea").value, "あ".repeat(500));
    assert.match(node.querySelector('[role="status"]').textContent, /再確認してください/);
    await React.act(async () => button(node, "キャンセル").click());
    assert.equal(node.querySelector("textarea"), null);
    await React.act(async () => button(node, "却下").click());
    assert.equal(node.querySelector("textarea").value, "");
    await React.act(async () => button(node, "理由を添えて却下").click());
    assert.deepEqual(calls, [["req/1", "あ".repeat(500)], ["req/1", ""]]);
    assert.equal(refreshes, 1);
    assert.equal(node.querySelector("textarea"), null);
  });
});

test("U03c 401 receipt hides private queue; unmounted receipt cannot refresh or navigate", async () => {
  let anonymous = 0;
  let refreshes = 0;
  const denied = reviewAdapter({
    approve: async () => ({ status: "anonymous" }),
    onAnonymous: () => { anonymous++; },
    onRefresh: () => { refreshes++; },
  });
  await withReviewBody(denied, async ({ node }) => {
    await React.act(async () => button(node, "承認").click());
    assert.equal(anonymous, 1);
    assert.equal(refreshes, 0);
    assert.doesNotMatch(node.textContent, /account1|Discord Staff|req\/1/);
    assert.equal(node.querySelectorAll("button").length, 0);
  });
  const receipt = deferred();
  const detached = reviewAdapter({
    approve: () => receipt.promise,
    onAnonymous: () => { anonymous++; },
    onRefresh: () => { refreshes++; },
  });
  await withReviewBody(detached, async ({ node, unmount }) => {
    await React.act(async () => button(node, "承認").click());
    await unmount();
    await React.act(async () => receipt.resolve(success));
    assert.equal(refreshes, 0);
    assert.equal(anonymous, 1);
  });
});

test("U03c acknowledged success survives refresh failure; network failure remains retryable without auto-replay", async () => {
  let calls = 0;
  let refreshes = 0;
  const actions = reviewAdapter({
    approve: async () => { calls++; if (calls === 1) throw new Error("private provider detail"); return success; },
    onRefresh: () => { refreshes++; throw new Error("private refresh detail"); },
  });
  await withReviewBody(actions, async ({ node }) => {
    await React.act(async () => button(node, "承認").click());
    assert.equal(calls, 1);
    assert.equal(refreshes, 0);
    assert.match(node.querySelector('[role="status"]').textContent, /再読み込み/);
    assert.doesNotMatch(node.textContent, /private provider detail/);
    assert.equal(button(node, "承認").disabled, false);
    await React.act(async () => button(node, "承認").click());
    assert.equal(calls, 2);
    assert.equal(refreshes, 1);
    assert.match(node.querySelector('[role="status"]').textContent, /処理しました.*一覧の再取得に失敗/);
    assert.doesNotMatch(node.textContent, /private refresh detail/);
    assert.equal(button(node, "承認").disabled, true);
  });
});
