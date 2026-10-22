// MIG-0403 Work Order tests T01-T04 on the built pages, plus the CURRENT `<head>`
// comparison. Run with `npm run test --workspace=@flamenode/site` (builds first).
// The CURRENT side is `src/lib/seo.ts` itself (buildPageMetadata, compactText) and
// `src/lib/youtube/id.ts`, loaded through the repo path-alias loader.
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

register("../../../../scripts/ts-path-alias-loader.mjs", import.meta.url);
process.env.NEXT_PUBLIC_SITE_URL = "https://flamenode.net";

const current = await import("../../../../src/lib/seo.ts");
const { youtubeThumbUrl } = await import("../../../../src/lib/youtube/id.ts");
const site = await import("./pageMetadata.ts");
const { loadRepresentativeEvents, loadRepresentativeUsers, loadRepresentativeVideos } = await import("./representativeFixtures.ts");
/** The non-public fixtures of representativeFixtures.ts (private / voided / deleted). */
const NON_PUBLIC_REPRESENTATIVE_IDS = [
  "video:repvideo-private", "video:repvideo-voided", "video:repvideo-deleted",
  "event:rep-event-private", "event:rep-event-deleted",
  "user:rep_private_user", "user:rep_deleted_user",
];
const { RESERVED_ASSET_PATHS, RESERVED_ROOT_SLUGS } = await import("./routeMap.ts");

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dist = path.join(siteRoot, "dist");
const read = (route) => fs.readFileSync(path.join(dist, route, "index.html"), "utf8");
const decode = (v) => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

const [videos, events, users] = await Promise.all([loadRepresentativeVideos(), loadRepresentativeEvents(), loadRepresentativeUsers()]);
const [video] = videos;
const [event] = events;
const [user] = users;

/** `<head>` as {title, canonical, tags: {"name|property": content}}. */
function head(html) {
  const h = html.slice(0, html.indexOf("</head>"));
  const tags = {};
  for (const m of h.matchAll(/<meta (name|property)="([^"]+)" content="([^"]*)">/g)) {
    assert.equal(tags[m[2]], undefined, `duplicate ${m[2]}`);
    tags[m[2]] = decode(m[3]);
  }
  return {
    title: decode(/<title>([^<]*)<\/title>/.exec(h)?.[1] ?? ""),
    canonical: decode(/<link rel="canonical" href="([^"]+)">/.exec(h)?.[1] ?? ""),
    tags,
  };
}

/** What Next renders for CURRENT `buildPageMetadata(...)` under the root layout (`%s | FlameNode`, robots, viewport). */
function currentHead(input) {
  const md = current.buildPageMetadata(input);
  const [image] = md.openGraph.images;
  const tags = {
    viewport: "width=device-width, initial-scale=1, viewport-fit=cover",
    description: md.description,
    robots: "index, follow",
    googlebot: "index, follow, max-video-preview:-1, max-image-preview:large, max-snippet:-1",
    "og:title": md.openGraph.title,
    "og:description": md.openGraph.description,
    "og:url": md.openGraph.url,
    "og:site_name": md.openGraph.siteName,
    "og:image": image.url,
    ...(image.width ? { "og:image:width": String(image.width), "og:image:height": String(image.height), "og:image:type": image.type } : {}),
    "og:image:alt": image.alt,
    "og:type": md.openGraph.type,
    "twitter:card": md.twitter.card,
    "twitter:title": md.twitter.title,
    "twitter:description": md.twitter.description,
    "twitter:image": md.twitter.images[0].url,
    "twitter:image:alt": md.twitter.images[0].alt,
  };
  return { title: `${md.title} | ${current.SITE_NAME}`, canonical: md.alternates.canonical, tags };
}

test("build output exists for the three representative pages", () => {
  assert.ok(fs.existsSync(dist), "run astro build first");
  assert.deepEqual(videos.map((v) => v.id), ["repvideo01"]);
  assert.deepEqual(events.map((e) => e.id), ["rep-event-2026"]);
  assert.deepEqual(users.map((u) => u.id), ["rep_creator"]);
  for (const route of ["repvideo01", video.youtubeVideoId, "event/rep-event-2026", "user/rep_creator"]) {
    assert.ok(fs.existsSync(path.join(dist, route, "index.html")), route);
  }
});

test("T01: private, voided and deleted fixtures produce no HTML and leak no text", () => {
  assert.equal(NON_PUBLIC_REPRESENTATIVE_IDS.length, 7);
  const htmlFiles = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".html")) htmlFiles.push(full);
    }
  };
  walk(dist);
  for (const entry of NON_PUBLIC_REPRESENTATIVE_IDS) {
    const [kind, id] = entry.split(":");
    const route = kind === "video" ? id : `${kind}/${id}`;
    assert.equal(fs.existsSync(path.join(dist, route)), false, `${entry} must not be built`);
    for (const file of htmlFiles) assert.doesNotMatch(fs.readFileSync(file, "utf8"), new RegExp(id), `${entry} in ${file}`);
  }
  for (const file of htmlFiles) {
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), /非公開作品|無効化作品|削除済み|非公開メモ|privateNote/, file);
  }
});

test("T02: the YouTube ID alias is the same page with the canonical of CURRENT (`/{youtube id}`)", () => {
  const byId = read(video.id);
  const byAlias = read(video.youtubeVideoId);
  assert.equal(byAlias, byId);
  assert.equal(head(byId).canonical, `https://flamenode.net/${video.youtubeVideoId}`);
});

test("T03: video <head> equals CURRENT generateMetadata (app/(public)/[id]/page.tsx:78-108)", () => {
  const expected = currentHead({
    title: `${video.title} - ${video.creatorName ?? "unknown"}`,
    description: current.compactText(video.introComment || video.highlights || [
      video.music ? `使用楽曲: ${video.music}` : null,
      video.credit ? `クレジット: ${video.credit}` : null,
    ].filter(Boolean).join(" / ")),
    path: `/${video.youtubeVideoId ?? video.id}`,
    image: video.youtubeVideoId ? youtubeThumbUrl(video.youtubeVideoId, "maxresdefault") : video.creatorIconUrl,
    ogType: "video.other",
  });
  assert.deepEqual(head(read(video.id)), expected);
});

test("T03: event <head> equals CURRENT generateMetadata (app/(public)/event/[id]/page.tsx:100-114)", () => {
  const expected = currentHead({
    title: event.title,
    description: event.explanation,
    path: `/event/${event.id}`,
    image: event.imageUrl ?? event.iconUrl,
  });
  assert.deepEqual(head(read(`event/${event.id}`)), expected);
});

test("T03: creator <head> equals CURRENT generateMetadata (app/(public)/user/[id]/UserProfilePage.tsx:114-137)", () => {
  const expected = currentHead({
    title: `${user.name} - クリエイター`,
    description: user.profileText ?? `FlameNodeで公開されている${user.name}の作品。`,
    path: `/user/${user.id}`,
    image: user.iconUrl,
    ogType: "profile",
  });
  assert.deepEqual(head(read(`user/${user.id}`)), expected);
});

test("T03: site buildPageMetadata matches CURRENT for fallback, long, blank and absolute inputs", () => {
  const cases = [
    { title: "No image", description: null, path: "/event/x" },
    { title: "  Blank  ", description: "   ", path: "/user/y", ogType: "profile" },
    { title: "Long", description: `${"あ".repeat(170)}\n\n end`, path: "/v", image: "https://cdn.example.com/a.png", ogType: "video.other" },
    { title: "Rel", description: "a\tb", path: "/v2", image: "/brand/flamenode-icon-512.png" },
  ];
  for (const input of cases) {
    const md = current.buildPageMetadata(input);
    const mine = site.buildPageMetadata(input);
    const [image] = md.openGraph.images;
    assert.deepEqual(
      { title: mine.title, description: mine.description, canonical: mine.canonical, ogType: mine.ogType, image: mine.image },
      {
        title: md.title,
        description: md.description,
        canonical: md.alternates.canonical,
        ogType: md.openGraph.type,
        image: Object.fromEntries(Object.entries({ url: image.url, alt: image.alt, width: image.width, height: image.height, type: image.type }).filter(([, v]) => v !== undefined)),
      },
      input.title,
    );
  }
});

test("T04: video paths do not collide with fixed routes, reserved slugs or assets", () => {
  for (const id of [video.id, video.youtubeVideoId]) {
    assert.equal(RESERVED_ROOT_SLUGS.has(id.toLowerCase()), false, id);
    assert.equal(RESERVED_ASSET_PATHS.has(id.toLowerCase()), false, id);
  }
  // Fixed folders are served by their own route files, not by `[id].astro`.
  assert.match(read(`event/${event.id}`), /class="[^"]*\bed-/);
  assert.match(read(`user/${user.id}`), /class="[^"]*\bpf-head\b/);
});

test("pages are static HTML with the shared CSS and no JavaScript", () => {
  for (const route of [video.id, `event/${event.id}`, `user/${user.id}`]) {
    const html = read(route);
    assert.doesNotMatch(html, /<script\b|<astro-island\b/, `${route} ships no JS`);
    const links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);
    assert.equal(links.length, 1, route);
    const css = fs.readFileSync(path.join(dist, links[0]), "utf8");
    // One rule from each of tokens.css, layout.css, components.css, screens.css.
    for (const marker of ["--lime-500:", ".hd2{", ".fn-row{", ".vd-layout"]) assert.ok(css.includes(marker), `${route} CSS lacks ${marker}`);
  }
});

test("every image has an alt attribute (decorative avatars/posters use alt=\"\" as CURRENT UserAvatar/YoutubePlayer)", () => {
  for (const route of [video.id, `event/${event.id}`, `user/${user.id}`]) {
    for (const img of read(route).matchAll(/<img\b[^>]*>/g)) assert.match(img[0], /\balt="[^"]*"/, `${route}: ${img[0]}`);
  }
  assert.match(read(`event/${event.id}`), /<img[^>]*alt="代表イベント 2026 メインビジュアル"/);
});

test("creator pagination links keep CURRENT query names (worksPage / collabPage)", async () => {
  const { creatorScreenData } = await import("./publicPages.ts");
  const data = creatorScreenData(user);
  assert.equal(data.works.buildHref(1), "/user/rep_creator");
  assert.equal(data.works.buildHref(2), "/user/rep_creator?worksPage=2");
  assert.equal(data.collabs.buildHref(3), "/user/rep_creator?collabPage=3");
});

test("video author block follows CURRENT: JST date, public-profile link only when allowed", async () => {
  const { videoScreenData } = await import("./publicPages.ts");
  const data = videoScreenData(video);
  assert.equal(data.publishedLabel, "2026/10/17");
  assert.equal(data.creator.profileHref, "/user/rep_creator");
  assert.equal(videoScreenData({ ...video, creatorHasPublicProfile: undefined }).creator.profileHref, null);
  assert.equal(videoScreenData({ ...video, creatorName: "  " }).creator.name, "作者未設定");
});

test("event status badge follows CURRENT app/(public)/event/[id]/page.tsx:234-236, never the Badge default DRAFT", async () => {
  const { eventStatusLabel } = await import("../../../../src/lib/utils/eventStatusCore.ts");
  const { eventScreenData } = await import("./publicPages.ts");
  const { EventDetailView } = await import("@flamenode/ui");
  const React = (await import("react")).default;
  const { renderToStaticMarkup } = await import("react-dom/server");
  const badge = (snapshot) => {
    const html = renderToStaticMarkup(React.createElement(EventDetailView, { event: eventScreenData(snapshot) }));
    const m = /<span class="fn-status fn-status--(\w+)" data-status="\w+"><span>([^<]*)<\/span><\/span>/.exec(html);
    assert.doesNotMatch(html, /DRAFT/);
    return m && { tone: m[1], label: m[2] };
  };
  // Snapshot label as written by the build; the CURRENT pill has one accent style for every status.
  assert.deepEqual(badge(event), { tone: "public", label: "開始前" });
  // No label in the snapshot: only public events are published, so CURRENT computeEventStatus gives `published`.
  for (const statusLabel of [undefined, ""]) {
    assert.deepEqual(badge({ kind: "event", id: "e1", title: "T", statusLabel }), { tone: "public", label: eventStatusLabel("published") });
  }
  assert.match(read(`event/${event.id}`), /<span class="fn-status fn-status--public" data-status="public"><span>開始前<\/span><\/span>/);
});
