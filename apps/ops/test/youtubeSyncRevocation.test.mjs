import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { YoutubeSync, youtubeSyncRevokedDestination } from "../.test-dist/apps/ops/src/routes/admin/YoutubeSync.js";

const reply = (status, value = {}) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json" },
});
const fixture = {
  filters: {
    sync_status: "", privacy: "", availability: "", visibility: "",
    failed: false, stale: false, missing: false,
  },
  hasMore: false, truncated: false,
  rows: [{
    video_id: "sec804-video", title: "SEC804_PRIVATE_METADATA_CANARY",
    creator_name: "SEC804_PRIVATE_CREATOR_CANARY", youtube_video_id: "dQw4w9WgXcQ",
    visibility_status: "private", youtube_privacy_status: "private",
    youtube_availability_status: "available", duration_seconds: 30,
    view_count: 7, sync_status: "failed", sync_error: "redacted",
    synced_at: null, updated_at: null,
  }],
};
const resyncButton = container => [...container.querySelectorAll("button")]
  .find(node => node.getAttribute("aria-label")?.includes("YouTubeメタデータ再同期を予約"));

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function withYoutubeSync(fetchFn, exercise) {
  const { JSDOM, VirtualConsole } = await import("jsdom");
  const { createRoot } = await import("react-dom/client");
  const dom = new JSDOM("<div id='root'></div>", {
    url: "https://flamenode.test/admin/youtube-sync",
    // jsdom cannot navigate; the DOM/redirect mapping is asserted independently.
    virtualConsole: new VirtualConsole(),
  });
  const previous = new Map();
  for (const [key, value] of [
    ["window", dom.window], ["document", dom.window.document],
    ["navigator", dom.window.navigator], ["fetch", fetchFn],
    // Node's undici FormData cannot serialize a jsdom HTMLFormElement.
    // The mounted filter form must use the browser-compatible constructor.
    ["FormData", dom.window.FormData],
    ["IS_REACT_ACT_ENVIRONMENT", true],
  ]) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const container = dom.window.document.querySelector("#root");
  const root = createRoot(container);
  try {
    await React.act(async () => {
      root.render(React.createElement(MemoryRouter, null, React.createElement(YoutubeSync)));
    });
    await exercise(container, dom.window);
  } finally {
    await React.act(async () => root.unmount());
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    dom.window.close();
  }
}

test("SEC-804: auth denial has fixed same-origin destinations; 503 is not revocation", () => {
  assert.equal(youtubeSyncRevokedDestination("anonymous"), "/entry");
  assert.equal(youtubeSyncRevokedDestination("forbidden"), "/dashboard");
  for (const status of ["ok", "unavailable", "notFound", "unsupported", "outcome"]) {
    assert.equal(youtubeSyncRevokedDestination(status), null);
  }
});

test("SEC-804: authorized diagnostics and resync controls disappear on POST 401/403", async () => {
  for (const denied of [401, 403]) {
    let postCount = 0;
    await withYoutubeSync(async (url, init) => {
      if (init.method === "GET") {
        assert.match(url, /^\/api\/admin-read\/ops\/youtube-sync(?:\?|$)/);
        return reply(200, fixture);
      }
      assert.equal(init.method, "POST");
      postCount += 1;
      return reply(denied, { redirect: "https://evil.example", ok: true });
    }, async (container, win) => {
      assert.match(container.textContent, /SEC804_PRIVATE_METADATA_CANARY/);
      assert.match(container.textContent, /SEC804_PRIVATE_CREATOR_CANARY/);
      const button = resyncButton(container);
      assert.ok(button);
      await React.act(async () => {
        button.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
      });
      assert.equal(postCount, 1);
      assert.match(container.textContent, /YouTube同期管理画面へのアクセスが終了しました/);
      assert.doesNotMatch(container.textContent, /SEC804_PRIVATE_METADATA_CANARY|SEC804_PRIVATE_CREATOR_CANARY/);
      assert.equal(resyncButton(container), undefined);
      assert.equal(container.querySelectorAll("button").length, 0);
    });
  }
});

test("SEC-804: initial GET 401/403 revokes, ordinary 503 stays a generic error", async () => {
  for (const status of [401, 403, 503]) {
    await withYoutubeSync(async (_url, init) => {
      assert.equal(init.method, "GET");
      return reply(status, { redirect: "https://evil.example", ...fixture });
    }, async container => {
      if (status === 503) {
        assert.match(container.textContent, /同期状態を取得できませんでした/);
        assert.doesNotMatch(container.textContent, /アクセスが終了しました/);
      } else {
        assert.match(container.textContent, /YouTube同期管理画面へのアクセスが終了しました/);
        assert.equal(container.querySelectorAll("button").length, 0);
      }
      assert.doesNotMatch(container.textContent, /SEC804_PRIVATE_METADATA_CANARY/);
      assert.equal(resyncButton(container), undefined);
    });
  }
});

test("SEC-804: a stale successful GET cannot republish data after POST revocation", async () => {
  const lateGet = deferred();
  const latePost = deferred();
  let getCount = 0, postCount = 0;
  await withYoutubeSync(async (_url, init) => {
    if (init.method === "GET") {
      getCount += 1;
      return getCount === 1 ? reply(200, fixture) : lateGet.promise;
    }
    assert.equal(init.method, "POST");
    postCount += 1;
    return latePost.promise;
  }, async (container, win) => {
    assert.match(container.textContent, /SEC804_PRIVATE_METADATA_CANARY/);
    await React.act(async () => {
      resyncButton(container).dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(postCount, 1);

    const select = container.querySelector('select[name="sync_status"]');
    select.value = "failed";
    const form = select.closest("form");
    await React.act(async () => {
      form.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    });
    assert.equal(getCount, 2);

    await React.act(async () => latePost.resolve(reply(403, { redirect: "//evil.example" })));
    assert.match(container.textContent, /アクセスが終了しました/);
    await React.act(async () => lateGet.resolve(reply(200, fixture)));
    assert.doesNotMatch(container.textContent, /SEC804_PRIVATE_METADATA_CANARY/);
    assert.equal(resyncButton(container), undefined);
    assert.equal(postCount, 1);
  });
});
