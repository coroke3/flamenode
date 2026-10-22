// MIG-0507 U01/U02/U05 characterization: built `/[id]` pages from video-detail snapshots vs CURRENT
// app/(public)/[id]/page.tsx (head, VideoObject/Person JSON-LD, links, members, chapters, related), the route-map
// collision fence and fail-closed snapshot handling. Builds the site per case (run with --test-concurrency=1).
// Run `npm run build -w @flamenode/ui` first.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JSDOM } from "jsdom";

const page = fs.readFileSync("app/(public)/[id]/page.tsx", "utf-8");
const text = (el) => el.textContent.replace(/\s+/g, " ").trim();
const NOW = Math.floor(Date.now() / 1000);
const D = 86400;
const keyOf = (id) => `snapshot/video-detail/${id}.json`;

const payload = (over = {}) => ({
  schema_version: 1,
  generated_at: NOW,
  video: {
    id: "vid1", title: "題名", youtube_video_id: "AAAAAAAAA01", creator_display_name: "作者", creator_x_user_id: "creator_x",
    creator_has_public_profile: true, creator_youtube_channel_url: "https://www.youtube.com/@creator", creator_icon_url: null,
    music: "曲名", credit: "歌手", music_reference_url: "https://example.com/m", intro_comment: "紹介文です", highlights: "見どころ",
    visibility_status: "public", scheduled_time: NOW - 30 * D, primary_event_id: "ev1", ...over.video,
  },
  event_ids: ["ev1", "ev2"],
  public_events: [
    { id: "ev1", title: "イベント1", visibility_status: "public", start_time: NOW - 5 * D, end_time: NOW + 5 * D },
    { id: "ev2", title: "イベント2", visibility_status: "public", start_time: NOW - 50 * D, end_time: NOW - 40 * D },
  ],
  public_members: [
    { id: "m1", display_name: "メンバー1", x_user_id: "member_one", role_label: "映像", has_public_profile: true },
    { id: "m2", display_name: "メンバー2", x_user_id: "member_two", role_label: "音", has_public_profile: false },
  ],
  member_chapters: [{ id: "mc1", video_member_id: "m1", chapter_time: 24, chapter_label: "冒頭" }],
  public_chapters: [{ id: "pc1", chapter_time: 70, chapter_label: "ここが好き", author_name: "視聴者" }],
  software_labels: ["After Effects", "Blender"],
  app_like_count: 7,
  related_videos: Array.from({ length: 14 }, (_, i) => ({ id: `r${i}`, title: `関連${i}`, youtube_video_id: `BBBBBBBBB${String(i).padStart(2, "0")}`, display_name: `作者${i}` })),
  ...over.top,
});

const envelope = (key, p, o = {}) => ({ schemaVersion: 1, generation: "g1", key, visibility: "public", payload: p, sha256: createHash("sha256").update(JSON.stringify(p)).digest("hex"), ...o });

function build(videos, over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fn-vid-"));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "fn-vid-out-"));
  const keys = [];
  // A configured build is all-or-nothing: the other pages of the site need their own (minimal) snapshots.
  const row = { id: "v1", title: "作品", youtube_video_id: "CCCCCCCCC01", display_name: "作者", status: "public" };
  const extra = {
    "snapshot/list/first-page.json": { videos: [row], total: 1 },
    "snapshot/recommend/current.json": { generated_at: 1, recommended: [row], latest: [], underrated: [], creators: [] },
    "snapshot/trending/current.json": { schema_version: 1, generated_at: 1, items: [] },
    "snapshot/top/current.json": { generated_at: 1, recommended: [row] },
  };
  for (const [key, p] of Object.entries(extra)) {
    fs.mkdirSync(path.dirname(path.join(dir, key)), { recursive: true });
    fs.writeFileSync(path.join(dir, key), JSON.stringify(envelope(key, p)));
    keys.push(key);
  }
  for (const [id, p, o] of videos) {
    const key = keyOf(id);
    fs.mkdirSync(path.dirname(path.join(dir, key)), { recursive: true });
    fs.writeFileSync(path.join(dir, key), JSON.stringify(envelope(key, p, o)));
    keys.push(key);
  }
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ schemaVersion: 1, generation: "g1", allowedKeys: keys, blockedKeys: over.blocked ?? [] }));
  const env = { ...process.env, FLAMENODE_SNAPSHOT_DIR: dir, FLAMENODE_SNAPSHOT_MANIFEST_FILE: path.join(dir, "manifest.json"), FLAMENODE_SNAPSHOT_GENERATION: "g1" };
  try {
    execFileSync(process.execPath, [path.resolve("node_modules/astro/astro.js"), "build", "--outDir", out], { cwd: path.resolve("apps/site"), env, stdio: "pipe" });
    return { out, dir, error: null };
  } catch (error) {
    return { out, dir, error: `${error.stdout ?? ""}${error.stderr ?? ""}`.replace(/[[0-9;]*m/g, "").slice(-1500) };
  }
}
const clean = (r) => { fs.rmSync(r.out, { recursive: true, force: true }); fs.rmSync(r.dir, { recursive: true, force: true }); };
const dom = (r, file) => new JSDOM(fs.readFileSync(path.join(r.out, file), "utf-8")).window.document;

test("snapshot build: YouTube-id and internal-id pages, head, JSON-LD and body follow CURRENT", () => {
  // The other pages of the build need no snapshot unless the env is set; the video build alone must be accepted
  // by every page, so give the site's other readers an empty-by-design environment (about-stats is optional).
  const r = build([["vid1", payload()]]);
  try {
    assert.equal(r.error, null, r.error ?? "");
    const doc = dom(r, "AAAAAAAAA01/index.html");
    assert.equal(doc.title, "題名 - 作者 | FlameNode");
    assert.equal(doc.querySelector('link[rel="canonical"]').href, "https://flamenode.net/AAAAAAAAA01");
    assert.equal(doc.querySelector('meta[property="og:type"]').content, "video.other");
    assert.equal(doc.querySelector('meta[property="og:image"]').content, "https://flamenode.net/api/youtube-thumbnail/AAAAAAAAA01/maxresdefault");
    assert.equal(doc.querySelector('meta[name="description"]').content, "紹介文です");
    assert.equal(doc.querySelector('meta[name="robots"]').content, "index, follow");
    const alias = dom(r, "vid1/index.html");
    assert.equal(alias.querySelector('link[rel="canonical"]').href, "https://flamenode.net/AAAAAAAAA01", "alias canonical is the YouTube-id URL");

    // G06 / T06: VideoObject + Person exactly as CURRENT builds them.
    const ld = [...doc.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent)).find((x) => x["@type"] === "VideoObject");
    assert.deepEqual(ld, {
      "@context": "https://schema.org", "@type": "VideoObject", name: "題名", description: "紹介文です",
      url: "https://flamenode.net/AAAAAAAAA01",
      thumbnailUrl: ["https://flamenode.net/api/youtube-thumbnail/AAAAAAAAA01/maxresdefault"],
      uploadDate: new Date((NOW - 30 * D) * 1000).toISOString(),
      embedUrl: "https://www.youtube.com/embed/AAAAAAAAA01", contentUrl: "https://www.youtube.com/watch?v=AAAAAAAAA01",
      author: { "@type": "Person", name: "作者", url: "https://flamenode.net/user/creator_x" },
    });
    for (const lit of ['"@type": "VideoObject"', '"@type": "Person"', "embedUrl: youtubeId ?", "contentUrl: youtubeId ?", "uploadDate: video.scheduled_time"]) assert.ok(page.includes(lit), lit);
    assert.ok(doc.querySelector("#flamenode-site-structured-data"), "site-wide graph stays");

    const main = doc.querySelector("main");
    assert.equal(text(main.querySelector("h1")), "題名");
    const hrefs = [...main.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    for (const h of ["/user/creator_x", "https://x.com/creator_x", "https://www.youtube.com/@creator", "/event/ev1", "/event/ev2", "/user/member_one", "https://example.com/m"]) assert.ok(hrefs.includes(h), h);
    assert.ok(!hrefs.includes("/user/member_two"), "member without a public profile is not linked");
    assert.match(text(main), /公開 \d{4}\/\d{2}\/\d{2}/);
    assert.match(text(main), /曲名 \/ 歌手/);
    assert.match(text(main), /After Effects, Blender/);
    assert.equal(main.querySelectorAll(".vd-mrow").length, 2);
    assert.deepEqual([...doc.querySelectorAll(".vd-chapter-time")].map(text), ["0:24", "1:10"]);
    assert.equal(doc.querySelectorAll(".vd-related a").length, 12, "CURRENT shows 12 related");
    assert.match(text(main.querySelector(".vd-like-count")), /7/);
    assert.equal(main.querySelector("button[data-do-nothing]"), null);
  } finally {
    clean(r);
  }
});

test("T01: a video id equal to a fixed route or asset path fails the build (route-map collision)", () => {
  const colliding = payload({ video: { id: "about", youtube_video_id: null } });
  const r = build([["about", colliding]]);
  try {
    assert.notEqual(r.error, null, "build must fail");
    assert.match(r.error, /collides with reserved|ROUTE_COLLISION|Route collision/);
  } finally {
    clean(r);
  }
});

test("T02: non-public, tampered or blocked snapshots fail the build instead of publishing", () => {
  for (const [name, videos, over] of [
    ["private video", [["vid1", payload({ video: { visibility_status: "private" } })]], {}],
    ["hash mismatch", [["vid1", payload(), { sha256: "a".repeat(64) }]], {}],
    ["nonpublic envelope", [["vid1", payload(), { visibility: "private" }]], {}],
    ["blocked key", [["vid1", payload()]], { blocked: [keyOf("vid1")] }],
  ]) {
    const r = build(videos, over);
    try {
      if (name === "blocked key") {
        assert.equal(r.error, null, "a blocked key is simply not enumerated");
        assert.equal(fs.existsSync(path.join(r.out, "AAAAAAAAA01/index.html")), false);
      } else {
        assert.notEqual(r.error, null, `${name} must fail`);
      }
    } finally {
      clean(r);
    }
  }
});
