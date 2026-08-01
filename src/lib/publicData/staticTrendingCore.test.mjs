import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeStaticTrending,
  resolveStaticTrendingStaleMeta,
  TRENDING_STALE_MAX_AGE_SEC,
  TRENDING_TOO_OLD_FOR_HOME_SEC,
} from "./staticTrendingCore.ts";

const sampleItem = {
  id: "v1",
  title: "Trending Video",
  youtube_video_id: "abcdefghijk",
  display_name: "Creator",
  icon_url: null,
  primary_event_id: null,
  primary_event_title: null,
  scheduled_time: 100,
  status: "public",
  views_2d: 12,
  views_5d: 20,
  views_7d: 25,
  views_30d: 40,
};

test("normalizeStaticTrending: valid payload を正規化する", () => {
  const data = normalizeStaticTrending({
    generated_at: 1_700_000_000,
    items: [sampleItem],
  });

  assert.ok(data);
  assert.equal(data.generatedAt, 1_700_000_000);
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].views_2d, 12);
  assert.equal(data.items[0].display_name, "Creator");
});

test("normalizeStaticTrending: creator_display_name を display_name へフォールバック", () => {
  const data = normalizeStaticTrending({
    generated_at: 100,
    items: [
      {
        ...sampleItem,
        display_name: undefined,
        creator_display_name: "Alt Creator",
      },
    ],
  });

  assert.ok(data);
  assert.equal(data.items[0].display_name, "Alt Creator");
});

test("normalizeStaticTrending: generated_at 欠損は null", () => {
  assert.equal(
    normalizeStaticTrending({ items: [sampleItem] }),
    null,
  );
});

test("normalizeStaticTrending: items 非配列は null", () => {
  assert.equal(
    normalizeStaticTrending({ generated_at: 100, items: "bad" }),
    null,
  );
});

test("normalizeStaticTrending: 空 items は generated_at あれば有効", () => {
  const data = normalizeStaticTrending({ generated_at: 100, items: [] });
  assert.ok(data);
  assert.equal(data.generatedAt, 100);
  assert.deepEqual(data.items, []);
});

test("normalizeStaticTrending: rank / video_id を正規化する", () => {
  const data = normalizeStaticTrending({
    generated_at: 100,
    items: [{ ...sampleItem, rank: 3, video_id: "v1" }],
  });
  assert.ok(data);
  assert.equal(data.items[0].rank, 3);
  assert.equal(data.items[0].video_id, "v1");
});

test("normalizeStaticTrending: video_id が id と不一致なら除外", () => {
  const data = normalizeStaticTrending({
    generated_at: 100,
    items: [{ ...sampleItem, video_id: "other" }],
  });
  assert.ok(data);
  assert.equal(data.items.length, 0);
});

test("normalizeStaticTrending: 不正 item は除外し全滅なら空配列", () => {
  const data = normalizeStaticTrending({
    generated_at: 100,
    items: [{ id: "only-id" }],
  });
  assert.ok(data);
  assert.deepEqual(data.items, []);
});

test("normalizeStaticTrending: views 欠損 item は除外", () => {
  const data = normalizeStaticTrending({
    generated_at: 100,
    items: [sampleItem, { ...sampleItem, id: "bad", views_2d: "x" }],
  });

  assert.ok(data);
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].id, "v1");
});

test("normalizeStaticTrending: public 以外の status は除外", () => {
  const data = normalizeStaticTrending({
    generated_at: 100,
    items: [{ ...sampleItem, status: "private" }],
  });

  assert.ok(data);
  assert.deepEqual(data.items, []);
});

test("resolveStaticTrendingStaleMeta: 3時間超で stale、24時間超で tooOldForHome", () => {
  const generatedAt = 1_000_000;
  const fresh = resolveStaticTrendingStaleMeta(
    generatedAt,
    generatedAt + TRENDING_STALE_MAX_AGE_SEC,
  );
  assert.equal(fresh.stale, false);
  assert.equal(fresh.tooOldForHome, false);
  assert.equal(fresh.ageSeconds, TRENDING_STALE_MAX_AGE_SEC);

  const stale = resolveStaticTrendingStaleMeta(
    generatedAt,
    generatedAt + TRENDING_STALE_MAX_AGE_SEC + 1,
  );
  assert.equal(stale.stale, true);
  assert.equal(stale.tooOldForHome, false);

  const tooOld = resolveStaticTrendingStaleMeta(
    generatedAt,
    generatedAt + TRENDING_TOO_OLD_FOR_HOME_SEC + 1,
  );
  assert.equal(tooOld.stale, true);
  assert.equal(tooOld.tooOldForHome, true);
});

test("resolveStaticTrendingStaleMeta: generatedAt null は stale + tooOldForHome", () => {
  const meta = resolveStaticTrendingStaleMeta(null, 1_000_000);
  assert.equal(meta.stale, true);
  assert.equal(meta.tooOldForHome, true);
  assert.equal(meta.ageSeconds, null);
});
