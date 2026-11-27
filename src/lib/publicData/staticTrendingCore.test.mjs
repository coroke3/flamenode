import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeStaticTrending,
  filterStaticTrendingByVisibilityFence,
  resolveStaticTrendingStaleMeta,
  TRENDING_STALE_MAX_AGE_SEC,
  TRENDING_TOO_OLD_FOR_HOME_SEC,
  TRENDING_MAX_FUTURE_SKEW_SEC,
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

test("Issue #653: visibility fence removes revoked video and revoked linked event cards without cache mutation", () => {
  const now = 1_700_000_000;
  const payload = normalizeStaticTrending({
    schema_version: 1, generated_at: now, items: [
      { ...sampleItem, id: "v-revoked", title: "private-video-secret" },
      { ...sampleItem, id: "v-event", title: "hidden-event-title",
        primary_event_id: "e-revoked", primary_event_title: "private event name" },
      { ...sampleItem, id: "v-public", title: "public video",
        primary_event_id: "e-public" },
    ],
  }, now);
  assert.ok(payload);
  const original = JSON.stringify(payload);
  const calls = [];
  const result = filterStaticTrendingByVisibilityFence(payload, (entity, id) => {
    calls.push(entity + ":" + id);
    return (entity === "video" && id === "v-revoked") ||
      (entity === "event" && id === "e-revoked");
  });
  assert.deepEqual(result.items.map((item) => item.id), ["v-public"]);
  assert.equal(result.generatedAt, payload.generatedAt, "stale age must remain unchanged");
  assert.equal(JSON.stringify(payload), original, "R2/Cache payload is never mutated");
  assert.ok(calls.includes("video:v-revoked"));
  assert.ok(calls.includes("event:e-revoked"));
  assert.ok(calls.includes("event:e-public"));
  const noBlocked = filterStaticTrendingByVisibilityFence(payload, () => false);
  assert.equal(noBlocked, payload, "no allocations on fully public fast path");
});

test("normalizeStaticTrending: valid payload を正規化する", () => {
  const data = normalizeStaticTrending({
    schema_version: 1,
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
    schema_version: 1,
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
    normalizeStaticTrending({ schema_version: 1, items: [sampleItem] }),
    null,
  );
});

test("normalizeStaticTrending: schema_version 欠損は null", () => {
  assert.equal(
    normalizeStaticTrending({ generated_at: 100, items: [sampleItem] }),
    null,
  );
});

test("normalizeStaticTrending: schema_version 不一致は null", () => {
  assert.equal(
    normalizeStaticTrending({
      schema_version: 2,
      generated_at: 100,
      items: [sampleItem],
    }),
    null,
  );
  assert.equal(
    normalizeStaticTrending({
      schema_version: "1",
      generated_at: 100,
      items: [sampleItem],
    }),
    null,
  );
});

test("normalizeStaticTrending: items 非配列は null", () => {
  assert.equal(
    normalizeStaticTrending({ schema_version: 1, generated_at: 100, items: "bad" }),
    null,
  );
});

test("normalizeStaticTrending: 空 items は generated_at + schema_version あれば有効", () => {
  const data = normalizeStaticTrending({
    schema_version: 1,
    generated_at: 100,
    items: [],
  });
  assert.ok(data);
  assert.equal(data.generatedAt, 100);
  assert.deepEqual(data.items, []);
});

test("normalizeStaticTrending: rank / video_id を正規化する", () => {
  const data = normalizeStaticTrending({
    schema_version: 1,
    generated_at: 100,
    items: [{ ...sampleItem, rank: 3, video_id: "v1" }],
  });
  assert.ok(data);
  assert.equal(data.items[0].rank, 3);
  assert.equal(data.items[0].video_id, "v1");
});

test("normalizeStaticTrending: video_id が id と不一致なら除外", () => {
  const data = normalizeStaticTrending({
    schema_version: 1,
    generated_at: 100,
    items: [{ ...sampleItem, video_id: "other" }],
  });
  assert.ok(data);
  assert.equal(data.items.length, 0);
});

test("normalizeStaticTrending: 不正 item は除外し全滅なら空配列", () => {
  const data = normalizeStaticTrending({
    schema_version: 1,
    generated_at: 100,
    items: [{ id: "only-id" }],
  });
  assert.ok(data);
  assert.deepEqual(data.items, []);
});

test("normalizeStaticTrending: views 欠損 item は除外", () => {
  const data = normalizeStaticTrending({
    schema_version: 1,
    generated_at: 100,
    items: [sampleItem, { ...sampleItem, id: "bad", views_2d: "x" }],
  });

  assert.ok(data);
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].id, "v1");
});

test("normalizeStaticTrending: public 以外の status は除外", () => {
  const data = normalizeStaticTrending({
    schema_version: 1,
    generated_at: 100,
    items: [{ ...sampleItem, status: "private" }],
  });

  assert.ok(data);
  assert.deepEqual(data.items, []);
});

test("Issue #653: noncanonical generated_at wire types cannot render public ranking", () => {
  const nowSec = 1_700_000_000;
  const payload = { schema_version: 1, generated_at: nowSec, items: [sampleItem] };
  const invalid = [
    null, false, true, "", "1700000000", -1, -0.5, 0.5, NaN,
    Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, {}, [],
  ];

  for (const generated_at of invalid) {
    assert.equal(
      normalizeStaticTrending({ ...payload, generated_at }, nowSec),
      null,
      `reject malformed R2 generated_at: ${String(generated_at)}`,
    );
  }

  assert.equal(normalizeStaticTrending({ ...payload, generated_at: 0 }, nowSec)?.generatedAt, 0,
    "the numeric Unix epoch remains valid for legacy artifacts");
  assert.equal(normalizeStaticTrending(payload, nowSec)?.generatedAt, nowSec,
    "canonical numeric timestamps remain accepted");
});

test("Issue #653: future-dated trending artifact beyond clock skew is rejected at read", () => {
  const nowSec = 1_700_000_000;
  const payload = {
    schema_version: 1,
    generated_at: nowSec + TRENDING_MAX_FUTURE_SKEW_SEC,
    items: [sampleItem],
  };
  assert.ok(normalizeStaticTrending(payload, nowSec),
    "small bounded clock skew must remain usable at the supplied build time");
  assert.equal(normalizeStaticTrending({
    ...payload,
    generated_at: nowSec + TRENDING_MAX_FUTURE_SKEW_SEC + 1,
  }, nowSec), null, "far-future artifact must never be treated as fresh");
  assert.equal(normalizeStaticTrending({
    ...payload,
    generated_at: Math.floor(Date.now() / 1000) + 86400,
  }), null, "default call sites use the real clock when no build time is supplied");
});

test("Issue #653: future trending metadata fails closed even without the normalizer", () => {
  const nowSec = 1_700_000_000;
  assert.deepEqual(resolveStaticTrendingStaleMeta(
    nowSec + TRENDING_MAX_FUTURE_SKEW_SEC + 1, nowSec,
  ), { stale: true, ageSeconds: null, tooOldForHome: true });
  assert.deepEqual(resolveStaticTrendingStaleMeta(
    nowSec + TRENDING_MAX_FUTURE_SKEW_SEC, nowSec,
  ), { stale: false, ageSeconds: 0, tooOldForHome: false });
});

test("Issue #653: malformed injected clock and raw stale timestamp always fail closed", () => {
  const nowSec = 1_700_000_000;
  const payload = {
    schema_version: 1,
    generated_at: nowSec,
    items: [sampleItem],
  };
  const blocked = { stale: true, ageSeconds: null, tooOldForHome: true };
  const invalidSeconds = [NaN, Infinity, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1];

  for (const invalid of invalidSeconds) {
    assert.equal(normalizeStaticTrending(payload, invalid), null,
      `invalid injected nowSec ${String(invalid)} must not bypass future validation`);
    assert.deepEqual(resolveStaticTrendingStaleMeta(nowSec, invalid), blocked,
      `invalid nowSec ${String(invalid)} must not be treated as fresh`);
    assert.deepEqual(resolveStaticTrendingStaleMeta(invalid, nowSec), blocked,
      `invalid generatedAt ${String(invalid)} must not be treated as fresh`);
  }

  const zero = normalizeStaticTrending({ ...payload, generated_at: 0 }, 0);
  assert.ok(zero, "Unix epoch zero remains a valid reader timestamp");
  assert.deepEqual(resolveStaticTrendingStaleMeta(0, 0), {
    stale: false, ageSeconds: 0, tooOldForHome: false,
  });
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

test("SEC-837 U02: reject explicit nonpublic or malformed visibility markers; preserve legacy missing/null", () => {
  const markers = [undefined, null, "public", "private", "draft", "unlisted", "", " public ", false, 0, [], {}];
  const allowed = (value) => value == null || value === "public";
  for (const status of markers) {
    for (const visibility_status of markers) {
      const result = normalizeStaticTrending({
        schema_version: 1, generated_at: 100,
        items: [{ ...sampleItem, status, visibility_status }],
      }, 100);
      assert.ok(result);
      assert.equal(result.items.length, Number(allowed(status) && allowed(visibility_status)),
        JSON.stringify({ status, visibility_status }));
      if (result.items.length) assert.equal(result.items[0].status, "public");
    }
  }
});

test("SEC-837 U02: mixed ranking preserves order, rank, counts and identity of public survivors", () => {
  const items = [
    { ...sampleItem, id: "public-a", status: undefined, rank: 2, video_id: "public-a" },
    { ...sampleItem, id: "hidden", visibility_status: "private", rank: 3 },
    { ...sampleItem, id: "public-b", visibility_status: null, rank: 8, video_id: "public-b" },
    { ...sampleItem, id: "conflict", status: "draft", visibility_status: "public" },
    { ...sampleItem, id: "public-c", visibility_status: "public", rank: 10, video_id: "public-c" },
  ];
  const before = JSON.stringify(items);
  const result = normalizeStaticTrending({ schema_version: 1, generated_at: 100, items }, 100);
  assert.ok(result);
  assert.deepEqual(result.items.map(x => [x.id, x.rank, x.views_7d, x.video_id]), [
    ["public-a", 2, 25, "public-a"],
    ["public-b", 8, 25, "public-b"],
    ["public-c", 10, 25, "public-c"],
  ]);
  assert.equal(JSON.stringify(items), before);
});
