// MIG-0511 U01: CURRENT public X icon priority and optional verified snapshot fallback.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  loadPublicXIconMapForBuild,
  portfolioIconUrl,
  projectEventDetailIcons,
  projectPublicXIconMap,
} from "../apps/site/src/lib/publicIconMap.ts";
import { PUBLIC_X_ICON_MAP_KEY } from "../apps/site/src/lib/publicDataLoader.ts";
import { buildVideoPages } from "../apps/site/src/lib/videoPage.ts";
import { FIXTURE_VIDEO_DETAIL_PAYLOADS } from "../apps/site/src/lib/videoFixtures.ts";
import { buildPortfolioHead } from "../apps/site/src/lib/userViews.ts";

const entry = (source, icon_url) => ({ source, icon_url });
const user = (id, icon_url) => ({ x_id: id, x_name: id, icon_url });

test("T01: registered and none priorities are preserved, public index fills video and missing entries", () => {
  const primary = {
    schema_version: 1, generated_at: 100, entries: {
      registered_a: entry("registered", "https://example.com/old-reg.png"),
      none_a: entry("none", "https://example.com/old-none.png"),
      video_a: entry("video", "https://example.com/old-video.png"),
      video_missing: entry("video", "https://example.com/fallback.png"),
    },
  };
  const index = {
    generated_at: 200,
    items: [
      user("registered_a", "https://example.com/new-reg.png"),
      user("none_a", "https://example.com/new-none.png"),
      user("video_a", "https://example.com/new-video.png"),
      user("new_user", null),
      user("video_missing", null),
    ],
  };
  const result = projectPublicXIconMap(primary, index);
  assert.ok(result);
  assert.equal(result.generated_at, 100);
  assert.deepEqual(result.entries.registered_a, primary.entries.registered_a);
  assert.deepEqual(result.entries.none_a, primary.entries.none_a);
  assert.deepEqual(result.entries.video_a, entry("registered", "https://example.com/new-video.png"));
  assert.deepEqual(result.entries.video_missing, entry("none", "https://example.com/fallback.png"));
  assert.deepEqual(result.entries.new_user, entry("none", null));
  assert.deepEqual(projectPublicXIconMap(primary, null), primary);
  assert.equal(projectPublicXIconMap(null, null), null);
  const fromIndex = projectPublicXIconMap(null, index);
  assert.equal(fromIndex.generated_at, 200);
  assert.deepEqual(fromIndex.entries.video_a, entry("registered", "https://example.com/new-video.png"));
});

test("T02: optional icon map accepts only a SHA-verified, manifest-allowed public snapshot", async () => {
  assert.equal((await loadPublicXIconMapForBuild({})).size, 0);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fn-icon-map-"));
  const keyFile = path.join(dir, PUBLIC_X_ICON_MAP_KEY);
  const manifestFile = path.join(dir, "manifest.json");
  const payload = {
    schema_version: 1, generated_at: 123,
    entries: { demo_user: entry("registered", "https://example.com/user.png") },
  };
  const sha256 = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const writeManifest = (allowedKeys) => fs.writeFileSync(manifestFile,
    JSON.stringify({ schemaVersion: 1, generation: "g1", allowedKeys, blockedKeys: [] }));
  const writeEnvelope = (digest = sha256) => fs.writeFileSync(keyFile,
    JSON.stringify({ schemaVersion: 1, generation: "g1", key: PUBLIC_X_ICON_MAP_KEY,
      visibility: "public", sha256: digest, payload }));
  const env = {
    FLAMENODE_SNAPSHOT_DIR: dir,
    FLAMENODE_SNAPSHOT_MANIFEST_FILE: manifestFile,
    FLAMENODE_SNAPSHOT_GENERATION: "g1",
  };
  const warnings = [];
  const originalWarn = console.warn;
  try {
    fs.mkdirSync(path.dirname(keyFile), { recursive: true });
    writeEnvelope();
    writeManifest([]);
    assert.equal((await loadPublicXIconMapForBuild(env)).size, 0, "missing optional manifest entry");
    assert.equal(warnings.length, 0);
    writeManifest([PUBLIC_X_ICON_MAP_KEY]);
    const good = await loadPublicXIconMapForBuild(env);
    assert.deepEqual(good.get("demo_user"), entry("registered", "https://example.com/user.png"));

    console.warn = (message) => warnings.push(message);
    writeEnvelope("a".repeat(64));
    assert.equal((await loadPublicXIconMapForBuild(env)).size, 0, "tampered digest never displayed");
    assert.equal(warnings.length, 1, "only one safe warning for bad digest");
    assert.match(warnings[0], /HASH_MISMATCH/);
    assert.doesNotMatch(warnings[0], /example.com/);
    fs.rmSync(keyFile);
    assert.equal((await loadPublicXIconMapForBuild(env)).size, 0, "optional missing map");
  } finally {
    console.warn = originalWarn;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("T03: video members and creator profile links use only registered/none public icon projections", () => {
  const payload = structuredClone(FIXTURE_VIDEO_DETAIL_PAYLOADS["vid-bbb"]);
  payload.video.creator_has_public_profile = false;
  payload.public_members = [{
    id: "m1", display_name: "Member A", x_user_id: "member_a",
    role_label: "制作", icon_url: "https://example.com/old.png", has_public_profile: false,
  }];
  const noMap = buildVideoPages(payload, "fixture:vid-bbb", 1_790_000_000, new Map())[0];
  assert.equal(noMap.data.members[0].iconUrl, "https://example.com/old.png");
  assert.equal(noMap.data.members[0].profileHref, null);
  assert.equal(noMap.data.creator.profileHref, null);
  const iconMap = new Map([
    ["member_a", entry("registered", "https://example.com/new.png")],
    ["hato", entry("none", null)],
  ]);
  const enriched = buildVideoPages(payload, "fixture:vid-bbb", 1_790_000_000, iconMap)[0];
  assert.equal(enriched.data.members[0].iconUrl, "https://example.com/new.png");
  assert.equal(enriched.data.members[0].profileHref, "/user/member_a");
  assert.equal(enriched.data.creator.profileHref, "/user/hato");
  assert.equal(enriched.data.creator.iconUrl, noMap.data.creator.iconUrl,
    "CURRENT does not project the primary video's creator icon here");
});

test("T05: portfolio OGP projection stays browser-safe and matches the pure helper", () => {
  const iconMap = new Map([["portfolio", entry("registered", "https://example.com/portfolio.png")]]);
  const profile = { user: { id: "portfolio", x_name: "Creator", profile_text: null, icon_url: null } };
  const head = buildPortfolioHead(profile, iconMap);
  assert.equal(head.ogImage, portfolioIconUrl(profile.user, iconMap));
  const sharedViewModel = fs.readFileSync("apps/site/src/lib/userViews.ts", "utf8");
  assert.doesNotMatch(sharedViewModel, /from ["']\\.\\/publicIconMap\\.ts["']/,
    "browser UsersIndexIsland must not import Node fs/crypto snapshot loader transitively");
});

test("T04/T05: event detail icons and portfolio fallback keep current public profile semantics", () => {
  const iconMap = new Map([
    ["staff_a", entry("none", "https://example.com/new-staff.png")],
    ["creator_a", entry("registered", "https://example.com/new-creator.png")],
    ["portfolio", entry("registered", "https://example.com/portfolio.png")],
  ]);
  const detail = {
    publicStaff: [
      { x_user_id: "staff_a", icon_url: "https://example.com/old-staff.png", has_public_profile: false },
      { x_user_id: "other", icon_url: "https://example.com/other.png", has_public_profile: false },
    ],
    publicVideos: [{ creator_x_user_id: "creator_a", creator_icon_url: "https://example.com/old-video.png" }],
  };
  const projected = projectEventDetailIcons(detail, iconMap);
  assert.equal(projected.publicStaff[0].icon_url, "https://example.com/new-staff.png");
  assert.equal(projected.publicStaff[0].has_public_profile, true);
  assert.equal(projected.publicStaff[1].icon_url, "https://example.com/other.png");
  assert.equal(projected.publicStaff[1].has_public_profile, false);
  assert.equal(projected.publicVideos[0].creator_icon_url, "https://example.com/new-creator.png");
  assert.equal(detail.publicStaff[0].icon_url, "https://example.com/old-staff.png", "input not mutated");
  assert.equal(portfolioIconUrl({ id: "portfolio", icon_url: "https://example.com/profile.png" }, iconMap),
    "https://example.com/profile.png", "explicit profile icon takes priority");
  assert.equal(portfolioIconUrl({ id: "portfolio", icon_url: null }, iconMap),
    "https://example.com/portfolio.png");
  assert.equal(portfolioIconUrl({ id: "unknown", icon_url: null }, iconMap), null);
});
