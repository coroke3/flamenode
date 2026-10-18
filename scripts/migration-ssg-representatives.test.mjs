import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  REPRESENTATIVE_VIDEOS,
  REPRESENTATIVE_EVENTS,
  REPRESENTATIVE_USERS,
  getPublicRepresentativeVideos,
  getPublicRepresentativeEvents,
  getPublicRepresentativeUsers,
} from "../apps/site/src/lib/representativeFixtures.ts";
import { RESERVED_ROOT_SLUGS, RESERVED_ASSET_PATHS } from "../apps/site/src/lib/routeMap.ts";

const DIST_DIR = path.resolve("apps/site/dist");

test("MIG-0403 T01: private and deleted fixtures are never emitted to public SSG paths", () => {
  const publicVideos = getPublicRepresentativeVideos();
  assert.equal(publicVideos.some((v) => v.id === "private-video-hidden"), false);
  assert.equal(publicVideos.some((v) => v.id === "deleted-video-purged"), false);
  assert.equal(publicVideos.length, 2); // sample-video-1 and sample-video-alias

  const publicEvents = getPublicRepresentativeEvents();
  assert.equal(publicEvents.some((e) => e.id === "draft-secret-event"), false);
  assert.equal(publicEvents.some((e) => e.id === "deleted-event"), false);
  assert.equal(publicEvents.length, 1); // autumn-collab-2026

  const publicUsers = getPublicRepresentativeUsers();
  assert.equal(publicUsers.some((u) => u.id === "suspended-user"), false);
  assert.equal(publicUsers.some((u) => u.id === "deleted-user"), false);
  assert.equal(publicUsers.length, 1); // miku-producer

  // Verify dist directory does NOT contain private/deleted HTML files
  if (fs.existsSync(DIST_DIR)) {
    assert.equal(fs.existsSync(path.join(DIST_DIR, "private-video-hidden/index.html")), false);
    assert.equal(fs.existsSync(path.join(DIST_DIR, "deleted-video-purged/index.html")), false);
    assert.equal(fs.existsSync(path.join(DIST_DIR, "event/draft-secret-event/index.html")), false);
    assert.equal(fs.existsSync(path.join(DIST_DIR, "user/suspended-user/index.html")), false);
  }
});

test("MIG-0403 T02: alias fixture has canonical pointing to canonical primary URL", () => {
  const aliasVideo = REPRESENTATIVE_VIDEOS.find((v) => v.id === "sample-video-alias");
  assert.ok(aliasVideo);
  assert.equal(aliasVideo.canonicalUrl, "https://flamenode.net/sample-video-1");
  assert.equal(aliasVideo.aliasOf, "sample-video-1");

  if (fs.existsSync(DIST_DIR)) {
    const aliasHtmlPath = path.join(DIST_DIR, "sample-video-alias/index.html");
    if (fs.existsSync(aliasHtmlPath)) {
      const html = fs.readFileSync(aliasHtmlPath, "utf-8");
      assert.ok(html.includes('<link rel="canonical" href="https://flamenode.net/sample-video-1">'));
    }
  }
});

test("MIG-0403 T03: OGP metadata, title, and site_name follow CURRENT production rules", () => {
  if (fs.existsSync(DIST_DIR)) {
    // 1. Video Detail HTML verification
    const videoHtmlPath = path.join(DIST_DIR, "sample-video-1/index.html");
    assert.ok(fs.existsSync(videoHtmlPath), "sample-video-1/index.html must exist");
    const videoHtml = fs.readFileSync(videoHtmlPath, "utf-8");
    assert.ok(videoHtml.includes("<title>代表動画: FlameNodeローンチ記念フェス - FlameNode</title>"));
    assert.ok(videoHtml.includes('<link rel="canonical" href="https://flamenode.net/sample-video-1">'));
    assert.ok(videoHtml.includes('<meta property="og:type" content="video.other">'));
    assert.ok(videoHtml.includes('<meta property="og:site_name" content="FlameNode">'));
    assert.ok(videoHtml.includes('<meta property="og:image" content="https://flamenode.net/brand/ogp-default.png">'));
    assert.ok(videoHtml.includes('<meta name="description" content="FlameNode公式ローンチ記念動画です。ボカロ・合成音声による共創フェス。">'));

    // 2. Event Detail HTML verification
    const eventHtmlPath = path.join(DIST_DIR, "event/autumn-collab-2026/index.html");
    assert.ok(fs.existsSync(eventHtmlPath), "event/autumn-collab-2026/index.html must exist");
    const eventHtml = fs.readFileSync(eventHtmlPath, "utf-8");
    assert.ok(eventHtml.includes("<title>FlameNode Autumn Festival 2026 - FlameNode</title>"));
    assert.ok(eventHtml.includes('<link rel="canonical" href="https://flamenode.net/event/autumn-collab-2026">'));
    assert.ok(eventHtml.includes('<meta property="og:type" content="website">'));
    assert.ok(eventHtml.includes('<meta property="og:image" content="https://flamenode.net/brand/banner.png">'));

    // 3. Creator Profile HTML verification
    const userHtmlPath = path.join(DIST_DIR, "user/miku-producer/index.html");
    assert.ok(fs.existsSync(userHtmlPath), "user/miku-producer/index.html must exist");
    const userHtml = fs.readFileSync(userHtmlPath, "utf-8");
    assert.ok(userHtml.includes("<title>初音P (Miku Producer) - FlameNode</title>"));
    assert.ok(userHtml.includes('<link rel="canonical" href="https://flamenode.net/user/miku-producer">'));
    assert.ok(userHtml.includes('<meta property="og:type" content="profile">'));
    assert.ok(userHtml.includes('<meta property="og:image" content="https://flamenode.net/brand/avatar-miku.png">'));
  }
});

test("MIG-0403 T04: Astro dynamic root [id].astro does not collide with reserved slugs or folder routes", () => {
  // Verify that representative video IDs do not collide with any reserved root slugs or assets
  const publicVideos = getPublicRepresentativeVideos();
  for (const video of publicVideos) {
    assert.equal(
      RESERVED_ROOT_SLUGS.has(video.id),
      false,
      `Video ID '${video.id}' must not collide with reserved root slug`,
    );
    assert.equal(
      RESERVED_ASSET_PATHS.has(video.id),
      false,
      `Video ID '${video.id}' must not collide with reserved asset path`,
    );
  }

  // Astro file-system routing priority ensures folder routes (/event/[id]/index.astro, /user/[id]/index.astro)
  // are resolved directly and never shadowed by root /[id].astro.
  assert.ok(fs.existsSync(path.resolve("apps/site/src/pages/[id].astro")));
  assert.ok(fs.existsSync(path.resolve("apps/site/src/pages/event/[id]/index.astro")));
  assert.ok(fs.existsSync(path.resolve("apps/site/src/pages/user/[id]/index.astro")));
});
