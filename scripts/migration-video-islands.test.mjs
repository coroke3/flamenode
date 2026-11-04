// MIG-0513: Hono SA-087 browser client / CURRENT interaction parity.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import React from "react";
import { createRoot } from "react-dom/client";

const goodOverlay = {
  loggedIn: true, authUnavailable: false, isBanned: false,
  isTosAccepted: true, termsReacceptRequired: false,
  activeXId: null, likeActive: false, bookmarkActive: false,
  viewerXApproved: false, privateChapters: [], playlistLabel: "再生リスト", playlistItems: [],
};
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});
const buildExists = fs.existsSync("packages/ui/dist/index.js") && fs.existsSync("packages/contracts/dist/index.js");
const skipHydrated = buildExists ? false : process.env.REQUIRE_BUILT ? false : "requires built @flamenode/ui and @flamenode/contracts";

test("T01/T02: SA-087 same-origin JSON client, API error and malformed/network failure", { skip: skipHydrated }, async () => {
  // Dynamic: videoInteraction.ts imports @flamenode/contracts, which needs its dist build.
  const { toggleInteraction } = await import("../apps/site/src/lib/videoInteraction.ts");
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return json({ ok: true, active: false, videoId: "video-1" });
  };
  assert.deepEqual(await toggleInteraction("video-1", "like", undefined, fetcher),
    { ok: true, active: false, videoId: "video-1" });
  assert.equal(calls[0].url, "/api/videos/video-1/interaction");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(calls[0].options.cache, "no-store");
  assert.deepEqual(JSON.parse(calls[0].options.body), { kind: "like" });
  assert.deepEqual(await toggleInteraction("vid", "bookmark", undefined, async () => json({ ok: false, message: "競合" }, 409)),
    { ok: false, message: "競合" });
  await assert.rejects(toggleInteraction("vid", "like", undefined, async () => json({ unexpected: 1 })), /Invalid interaction/);
  await assert.rejects(toggleInteraction("vid", "like", undefined, async () => json({ ok: true, active: "yes" })), /Invalid interaction response/);
  await assert.rejects(toggleInteraction("vid", "like", undefined, async () => json({ ok: true }, 503)), /Invalid success/);
  await assert.rejects(toggleInteraction("", "like", undefined, fetcher), /Invalid interaction request/);
  await assert.rejects(toggleInteraction("vid", "like", undefined, async () => { throw Error("offline"); }), /offline/);
});

test("T04: static video detail has no nonfunctional interaction buttons", () => {
  const source = fs.readFileSync("apps/site/src/components/VideoPageIsland.ts", "utf8");
  assert.match(source, /React\.useEffect\(\(\) => \{ setMounted\(true\); \}, \[\]\)/);
  assert.match(source, /const interactions = mounted/);
  // Fixture pages (videoFixtures.ts): vid-aaa at its internal id and at its YouTube id.
  for (const slug of ["vid-aaa", "dKw1xV41f8s"]) {
    const path = `apps/site/dist/${slug}/index.html`;
    if (!fs.existsSync(path)) {
      assert.ok(!process.env.REQUIRE_BUILT, `${path} must exist when REQUIRE_BUILT=1`);
      continue;
    }
    const doc = new JSDOM(fs.readFileSync(path, "utf8")).window.document;
    assert.ok(doc.querySelector(".vd-acts"), `${slug}: action row is present in static HTML`);
    assert.equal(doc.querySelector(".vd-acts button"), null, `${slug}: no nonfunctional buttons`);
  }
});

test("T05/T06: identical CURRENT permission/redirect matrix; zero Active X allowed", { skip: skipHydrated }, async () => {
  const { interactionPolicy } = await import("../apps/site/src/components/VideoInteractionIsland.ts");
  const path = "/AAAAAAAAAAA"; // CURRENT next= is `/${rawId}` without query
  const base = { ...goodOverlay };
  assert.equal(interactionPolicy(base, false, path).canInteract, true, "no Active X is permitted");
  assert.deepEqual(interactionPolicy(base, true, path), { canInteract: false, disabledReason: "ログイン状態を確認中です。" });
  assert.equal(interactionPolicy({ ...base, authUnavailable: true }, false, path).canInteract, false);
  const anon = interactionPolicy({ ...base, loggedIn: false }, false, path);
  assert.equal(anon.actionHref, "/entry?next=%2FAAAAAAAAAAA");
  assert.equal(anon.disabledReason, "ログインするといいね、セーブができます。");
  assert.equal(interactionPolicy({ ...base, isBanned: true }, false, path).actionHref, undefined);
  for (const o of [{ ...base, isTosAccepted: false }, { ...base, termsReacceptRequired: true }]) {
    const p = interactionPolicy(o, false, path);
    assert.equal(p.actionHref, "/rules?next=%2FAAAAAAAAAAA");
    assert.equal(p.canInteract, false);
  }
});

async function renderScenario(fetcher, check) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://flamenode.example/AAAAAAAAAAA" });
  const old = { window: globalThis.window, document: globalThis.document, HTMLElement: globalThis.HTMLElement,
    Node: globalThis.Node, fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT,
    CustomEvent: globalThis.CustomEvent };
  let root;
  try {
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.HTMLElement = dom.window.HTMLElement;
    globalThis.Node = dom.window.Node;
    globalThis.CustomEvent = dom.window.CustomEvent;
    globalThis.fetch = fetcher;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const { VideoInteractionIsland } = await import("../apps/site/src/components/VideoInteractionIsland.ts");
    const { invalidateVideoViewerOverlay } = await import("../apps/site/src/lib/viewerOverlay.ts");
    invalidateVideoViewerOverlay();
    root = createRoot(dom.window.document.getElementById("root"));
    await act(async () => { root.render(React.createElement(VideoInteractionIsland, { videoId: "vid", likeCount: 4 })); });
    await check(dom.window.document, dom.window);
    await act(async () => { root.unmount(); });
    invalidateVideoViewerOverlay();
  } finally {
    globalThis.window = old.window;
    globalThis.document = old.document;
    globalThis.HTMLElement = old.HTMLElement;
    globalThis.Node = old.Node;
    globalThis.CustomEvent = old.CustomEvent;
    globalThis.fetch = old.fetch;
    globalThis.IS_REACT_ACT_ENVIRONMENT = old.act;
    dom.window.close();
  }
}

test("regression: viewer overlay expires on a backward clock change in Astro and CURRENT", { skip: skipHydrated }, async () => {
  const { loadVideoViewerOverlay, invalidateVideoViewerOverlay } =
    await import("../apps/site/src/lib/viewerOverlay.ts");
  const currentSource = fs.readFileSync("src/lib/video/videoViewerOverlayClient.ts", "utf8");
  assert.match(currentSource, /ageMs >= 0/, "CURRENT must also reject negative cache ages");

  const realNow = Date.now;
  let clock = 1_760_000_000_000;
  let successfulReads = 0;
  let failedReads = 0;
  const okFetcher = async () => {
    successfulReads += 1;
    return json(goodOverlay);
  };
  const errorFetcher = async () => {
    failedReads += 1;
    return json({ error: "unavailable" }, 503);
  };
  try {
    Date.now = () => clock;
    invalidateVideoViewerOverlay();
    const first = await loadVideoViewerOverlay("rollback-success", "", okFetcher);
    assert.equal(first.loggedIn, true);
    await loadVideoViewerOverlay("rollback-success", "", okFetcher);
    assert.equal(successfulReads, 1, "unchanged clock reuses the fresh 30s cache");

    clock -= 60_000;
    await loadVideoViewerOverlay("rollback-success", "", okFetcher);
    assert.equal(successfulReads, 2, "backward clock must refetch viewer data");

    const failure = await loadVideoViewerOverlay("rollback-failure", "", errorFetcher);
    assert.equal(failure.authUnavailable, true);
    await loadVideoViewerOverlay("rollback-failure", "", errorFetcher);
    assert.equal(failedReads, 1, "unchanged clock reuses the 3s failure cache");

    clock -= 60_000;
    await loadVideoViewerOverlay("rollback-failure", "", errorFetcher);
    assert.equal(failedReads, 2, "backward clock must expire the 3s failure cache too");
  } finally {
    Date.now = realNow;
    invalidateVideoViewerOverlay();
  }
});

test("T01/T03: optimistic count, server correction and rapid double click use one write", { skip: skipHydrated }, async () => {
  let resolveWrite; let writes = 0;
  const fetcher = async (url, options) => {
    if (options?.method === "POST") {
      writes++;
      return await new Promise(resolve => { resolveWrite = resolve; });
    }
    return json(goodOverlay);
  };
  await renderScenario(fetcher, async doc => {
    const button = doc.querySelector('button[aria-label="いいね"]');
    assert.ok(button, "live like button exists");
    assert.equal(button.disabled, false, "no X ID required");
    act(() => { button.click(); button.click(); });
    assert.equal(writes, 1);
    assert.match(doc.querySelector('button[aria-label="いいね済"]').textContent, /5/);
    await act(async () => { resolveWrite(json({ ok: true, active: false, videoId: "vid" })); });
    assert.match(doc.querySelector('button[aria-label="いいね"]').textContent, /4/, "server authoritative state corrects optimistic count");
  });
});

test("T02: API denial and rejected fetch roll back and display CURRENT messages", { skip: skipHydrated }, async () => {
  for (const thrown of [false, true]) {
    const fetcher = async (url, options) => {
      if (options?.method === "POST") {
        if (thrown) throw new Error("offline");
        return json({ ok: false, message: "保存できません。" }, 409);
      }
      return json(goodOverlay);
    };
    await renderScenario(fetcher, async doc => {
      const btn = doc.querySelector('button[aria-label="いいね"]');
      await act(async () => { btn.click(); });
      assert.equal(doc.querySelector('button[aria-label="いいね"]').getAttribute("aria-pressed"), "false");
      assert.match(doc.querySelector('button[aria-label="いいね"]').textContent, /4/);
      assert.match(doc.querySelector('[role="alert"]').textContent,
        thrown ? /操作に失敗しました。通信状態を確認してもう一度お試しください。/ : /保存できません。/);
    });
  }
});

test("T05: viewer overlay 503 never permits write controls", { skip: skipHydrated }, async () => {
  await renderScenario(async () => json({ error: "viewer_overlay_unavailable" }, 503), async doc => {
    assert.equal(doc.querySelector('button[aria-label="いいね"]').disabled, true);
    assert.match(doc.body.textContent, /ログイン状態を一時的に確認できません/);
    assert.equal(doc.querySelector('a[href^="/entry"]'), null);
  });
});
