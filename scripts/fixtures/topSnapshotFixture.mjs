// MIG-0506 U01: unchanged public root/trending snapshot fixture extracted
// for snapshot-based SSG tests and the U02 390/1440 browser comparison.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  TOP_KEY, TRENDING_KEY, LIST_FIRST_PAGE_KEY, RECOMMEND_KEY,
} from "../../apps/site/src/lib/publicDataLoader.ts";

export const D = 86400;
export const ev = (id, o = {}) => ({ id, title: `イベント${id}`, visibility_status: "public", start_time: null, end_time: null, entry_start_time: null, entry_end_time: null, ...o });

export const row = (n, extra = {}) => ({ id: `v${n}`, title: `作品${n}`, youtube_video_id: `AAAAAAAAA${String(n).padStart(2, "0")}`, display_name: `作者${n}`, icon_url: null, primary_event_id: null, scheduled_time: 1790000000 + n, status: "public", ...extra });
export const nowSec = Math.floor(Date.now() / 1000);
export const topPayload = () => ({
  generated_at: nowSec,
  recommended: Array.from({ length: 12 }, (_, i) => row(10 + i)).concat([row(99, { status: "private" })]),
  latest: Array.from({ length: 12 }, (_, i) => row(30 + i)),
  nostalgic: Array.from({ length: 3 }, (_, i) => row(60 + i)),
  active_events: [
    ev("pvsf", { title: "PVSF2026", entry_start_time: nowSec - D, entry_end_time: nowSec + 12 * D - 3600, start_time: nowSec + 20 * D, end_time: nowSec + 21 * D }),
    ev("ongo", { title: "開催中祭", start_time: nowSec - D, end_time: nowSec + D }),
  ],
  latest_events: Array.from({ length: 5 }, (_, i) => ev(`le${i}`, { start_time: nowSec + (i + 1) * D, end_time: nowSec + (i + 2) * D })),
  announcements: Array.from({ length: 4 }, (_, i) => ({ id: `n${i}`, title: `お知らせ${i}`, body: i === 0 ? "あ".repeat(200) : "本文" })),
  creators: [{ id: "c1", x_name: "c1", icon_url: null, video_count: 1, collab_count: 0 }],
  slot_stats: [{ event_id: "pvsf", available: 32, total: 160 }],
  stats: { publicVideos: 3240, creators: 812, activeEvents: 2 },
});
export const trendingPayload = (generated = nowSec) => ({ schema_version: 1, generated_at: generated, items: Array.from({ length: 10 }, (_, i) => ({ ...row(80 + i), primary_event_title: null, views_2d: 1, views_5d: 2, views_7d: 3, views_30d: 4, rank: i + 1 })) });

export function envelope(key, payload, over = {}) {
  return { schemaVersion: 1, generation: "g1", key, visibility: "public", payload, sha256: createHash("sha256").update(JSON.stringify(payload)).digest("hex"), ...over };
}
export function writeSnapshot(dir, { top = topPayload(), trending = trendingPayload() } = {}, over = {}) {
  fs.mkdirSync(path.join(dir, "snapshot/top"), { recursive: true });
  fs.mkdirSync(path.join(dir, "snapshot/trending"), { recursive: true });
  // The other pages of the same site build need their own snapshots (a configured build is all-or-nothing).
  fs.mkdirSync(path.join(dir, "snapshot/list"), { recursive: true });
  fs.mkdirSync(path.join(dir, "snapshot/recommend"), { recursive: true });
  fs.writeFileSync(path.join(dir, LIST_FIRST_PAGE_KEY), JSON.stringify(envelope(LIST_FIRST_PAGE_KEY, { videos: [row(1)], total: 1 })));
  fs.writeFileSync(path.join(dir, RECOMMEND_KEY), JSON.stringify(envelope(RECOMMEND_KEY, { generated_at: 1, recommended: [row(2)], latest: [], underrated: [], creators: [] })));
  fs.writeFileSync(path.join(dir, TOP_KEY), JSON.stringify(envelope(TOP_KEY, top, over.top)));
  fs.writeFileSync(path.join(dir, TRENDING_KEY), JSON.stringify(envelope(TRENDING_KEY, trending, over.trending)));
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ schemaVersion: 1, generation: "g1", allowedKeys: [TOP_KEY, TRENDING_KEY, LIST_FIRST_PAGE_KEY, RECOMMEND_KEY], blockedKeys: [] }));
  return { FLAMENODE_SNAPSHOT_DIR: dir, FLAMENODE_SNAPSHOT_MANIFEST_FILE: path.join(dir, "manifest.json"), FLAMENODE_SNAPSHOT_GENERATION: "g1" };
}

export function writeFixtureSnapshot(dir) {
  // Only write the visual fixture into a newly created temporary directory.
  // An empty or relative path would write snapshot/ and manifest.json into cwd.
  if (typeof dir !== "string" || !path.isAbsolute(dir) || dir === path.parse(dir).root) {
    throw new TypeError("Fixture directory must be a non-root absolute path");
  }
  if (!fs.existsSync(dir) || !fs.lstatSync(dir).isDirectory() || fs.readdirSync(dir).length !== 0) {
    throw new Error("Fixture directory must exist and be empty");
  }
  return writeSnapshot(dir);
}
