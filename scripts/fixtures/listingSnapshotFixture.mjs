// MIG-0505 U01: shared deterministic public listing snapshots for tests and
// the browser visual-parity build; fixture contents are unchanged from T01-T07.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  LIST_FIRST_PAGE_KEY, RECOMMEND_KEY, TRENDING_KEY, TOP_KEY,
} from "../../apps/site/src/lib/publicDataLoader.ts";

export function envelope(key, payload, over = {}) {
  return { schemaVersion: 1, generation: "g1", key, visibility: "public", payload, sha256: createHash("sha256").update(JSON.stringify(payload)).digest("hex"), ...over };
}
export const row = (n, extra = {}) => ({ id: `v${n}`, title: `作品${n}`, youtube_video_id: `AAAAAAAAA${String(n).padStart(2, "0")}`, display_name: `作者${n}`, icon_url: null, primary_event_id: n % 2 ? "ev1" : null, scheduled_time: 1790000000 + n, status: "public", ...extra });
export function writeSnapshot(dir, { list, recommend, trending }, over = {}) {
  fs.mkdirSync(path.join(dir, "snapshot/list"), { recursive: true });
  fs.mkdirSync(path.join(dir, "snapshot/recommend"), { recursive: true });
  fs.mkdirSync(path.join(dir, "snapshot/trending"), { recursive: true });
  fs.writeFileSync(path.join(dir, LIST_FIRST_PAGE_KEY), JSON.stringify(envelope(LIST_FIRST_PAGE_KEY, list, over.list)));
  fs.writeFileSync(path.join(dir, RECOMMEND_KEY), JSON.stringify(envelope(RECOMMEND_KEY, recommend, over.recommend)));
  fs.writeFileSync(path.join(dir, TRENDING_KEY), JSON.stringify(envelope(TRENDING_KEY, trending, over.trending)));
  // `/` is built from the same snapshot set (MIG-0506); a configured build is all-or-nothing.
  fs.mkdirSync(path.join(dir, "snapshot/top"), { recursive: true });
  fs.writeFileSync(path.join(dir, TOP_KEY), JSON.stringify(envelope(TOP_KEY, { generated_at: 1, recommended: [row(1)] })));
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ schemaVersion: 1, generation: "g1", allowedKeys: [LIST_FIRST_PAGE_KEY, RECOMMEND_KEY, TRENDING_KEY, TOP_KEY], blockedKeys: [] }));
  return { FLAMENODE_SNAPSHOT_DIR: dir, FLAMENODE_SNAPSHOT_MANIFEST_FILE: path.join(dir, "manifest.json"), FLAMENODE_SNAPSHOT_GENERATION: "g1" };
}
export const fixture = () => ({
  list: { videos: [row(1), row(2), row(3, { status: "private" }), row(4, { status: "voided" })], total: 1234 },
  recommend: {
    generated_at: 1790000000,
    recommended: Array.from({ length: 12 }, (_, i) => row(10 + i, { creator_x_user_id: `c${i}` })),
    latest: Array.from({ length: 4 }, (_, i) => row(30 + i, { creator_x_user_id: `d${i}` })),
    underrated: [row(40, { creator_x_user_id: "u0" }), row(41, { status: "private" })],
    creators: [],
  },
  trending: { schema_version: 1, generated_at: 1790000000, items: [
    { ...row(50), primary_event_title: "第一回", views_2d: 10, views_5d: 20, views_7d: 12345, views_30d: 99, rank: 1 },
    { ...row(51), primary_event_title: null, views_2d: 1, views_5d: 2, views_7d: 7, views_30d: 9, rank: 2 },
    { ...row(52, { status: "private" }), primary_event_title: null, views_2d: 1, views_5d: 2, views_7d: 7, views_30d: 9 },
  ] },
});

export function writeFixtureSnapshot(dir) {
  return writeSnapshot(dir, fixture());
}
