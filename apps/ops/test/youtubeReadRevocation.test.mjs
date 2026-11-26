import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { YoutubeQuota, youtubeQuotaRevokedDestination } from "../.test-dist/apps/ops/src/routes/admin/YoutubeQuota.js";
import { YoutubePlaylists, youtubePlaylistsRevokedDestination } from "../.test-dist/apps/ops/src/routes/admin/YoutubePlaylists.js";

const json = (status, data = {}) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json" },
});
const quota = {
  quotaDay: "2026-11-23", configuredUnits: 10000, budgetUnits: 8000,
  usedUnits: 1234, remainingUnits: 6766, usagePercent: 15.4,
  updatedAt: null, error: null,
};
const playlists = {
  filters: { enabled: "", status: "" }, hasMore: false,
  rows: [{
    event_id: "sec806-event", event_title: "SEC806_PRIVATE_PLAYLIST_CANARY",
    playlist_id: null, enabled: 1, sync_mode: "all",
    sync_interval_minutes: 60, sync_status: "failed",
    next_sync_at: null, last_synced_at: null, last_full_scan_at: null,
    last_error: "SEC806_PRIVATE_ERROR_CANARY",
    linked_count: 1, eligible_count: 1, synced_count: 0,
    health: { level: "critical", reason: "failed", priority: 1 },
  }],
};

async function mountedPage(Component, fetchFn, exercise) {
  const { JSDOM, VirtualConsole } = await import("jsdom");
  const { createRoot } = await import("react-dom/client");
  const dom = new JSDOM("<div id='root'></div>", {
    url: "https://flamenode.test/admin/youtube-quota",
    // jsdom does not implement location.assign; test fixed redirect mapping separately.
    virtualConsole: new VirtualConsole(),
  });
  const previous = new Map();
  for (const [key, value] of [
    ["window", dom.window], ["document", dom.window.document],
    ["navigator", dom.window.navigator], ["fetch", fetchFn],
    ["FormData", dom.window.FormData], ["IS_REACT_ACT_ENVIRONMENT", true],
  ]) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true, writable: true, value,
    });
  }
  const container = dom.window.document.querySelector("#root");
  const root = createRoot(container);
  try {
    await React.act(async () => {
      root.render(React.createElement(MemoryRouter, null, React.createElement(Component)));
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

test("SEC-806: only HTTP 401/403 and mapped auth results select fixed internal destinations", () => {
  for (const fn of [youtubeQuotaRevokedDestination, youtubePlaylistsRevokedDestination]) {
    assert.equal(fn(401), "/entry");
    assert.equal(fn("anonymous"), "/entry");
    assert.equal(fn(403), "/dashboard");
    assert.equal(fn("forbidden"), "/dashboard");
    for (const normal of [200, 404, 503, "ok", "unavailable", "notFound"]) {
      assert.equal(fn(normal), null);
    }
  }
});

test("SEC-806: quota private data and refresh controls are unmounted on 401/403 headers even with stalled 403 body", async () => {
  for (const denied of [401, 403]) {
    let reads = 0, stalledJson = 0;
    await mountedPage(YoutubeQuota, async (_url, init) => {
      assert.equal(init.method, "GET");
      reads += 1;
      if (reads === 1) return json(200, quota);
      if (reads !== 2) assert.fail("unexpected GET after revocation");
      return {
        status: denied,
        // A 403 optional body that never resolves cannot delay revocation.
        json() { stalledJson++; return new Promise(() => {}); },
      };
    }, async (container, win) => {
      assert.match(container.textContent, /1,234/);
      assert.match(container.textContent, /quota日/);
      const button = [...container.querySelectorAll("button")]
        .find(node => node.textContent.includes("最新状態へ更新"));
      assert.ok(button);
      await React.act(async () => {
        button.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
      });
      assert.equal(reads, 2);
      assert.match(container.textContent, /YouTube quota管理へのアクセスが終了しました/);
      assert.doesNotMatch(container.textContent, /1,234|quota日|残り予算/);
      assert.equal(container.querySelectorAll("button").length, 0);
      await React.act(async () => {
        button.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
      });
      assert.equal(reads, 2, "removed control cannot schedule another privileged GET");
    });
    assert.equal(stalledJson, denied === 403 ? 1 : 0);
  }
});

test("SEC-806: playlist GET 401/403 clears privileged row and unmounts filter UI", async () => {
  for (const denied of [401, 403]) {
    let reads = 0, stalledJson = 0;
    await mountedPage(YoutubePlaylists, async (_url, init) => {
      assert.equal(init.method, "GET");
      reads++;
      if (reads === 1) return json(200, playlists);
      if (reads !== 2) assert.fail("unexpected GET after revocation");
      return {
        status: denied,
        json() { stalledJson++; return new Promise(() => {}); },
      };
    }, async (container, win) => {
      assert.match(container.textContent, /SEC806_PRIVATE_PLAYLIST_CANARY/);
      assert.match(container.textContent, /SEC806_PRIVATE_ERROR_CANARY/);
      const form = container.querySelector("form");
      const select = form.querySelector('select[name="status"]');
      select.value = "failed";
      await React.act(async () => {
        form.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
      });
      assert.equal(reads, 2);
      assert.match(container.textContent, /再生リスト同期管理へのアクセスが終了しました/);
      assert.doesNotMatch(container.textContent, /SEC806_PRIVATE_PLAYLIST_CANARY|SEC806_PRIVATE_ERROR_CANARY/);
      assert.equal(container.querySelectorAll("button").length, 0);
      assert.equal(container.querySelectorAll("form").length, 0);
    });
    assert.equal(stalledJson, denied === 403 ? 1 : 0);
  }
});

test("SEC-806: non-auth 503 does not revoke quota or playlist screen", async () => {
  for (const [Component, initialData, deniedText] of [
    [YoutubeQuota, quota, "quota情報を取得できませんでした"],
    [YoutubePlaylists, playlists, "再生リストを取得できませんでした"],
  ]) {
    await mountedPage(Component, async () => json(503, { ...initialData, redirect: "https://evil.example" }),
      async container => {
        assert.match(container.textContent, new RegExp(deniedText));
        assert.doesNotMatch(container.textContent, /アクセスが終了しました/);
        assert.ok(container.querySelector("button"), "503 still leaves safe retry/filter controls");
      });
  }
});
