import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  EVENTS_INDEX_MAX_ROWS,
  EVENT_GROUP_EVENT_MAX_PER_GROUP,
  EVENT_GROUP_EVENT_MAX_ROWS,
  EVENT_GROUP_MAX_ROWS,
  POPULAR_LIST_LIMIT,
  PUBLIC_STAFF_EVENT_ID_CHUNK_SIZE,
  PUBLIC_STAFF_MAX_PER_EVENT,
  RECENT_LIST_LIMIT,
  SEARCH_INDEX_VIDEO_LIMIT,
  STATIC_LIST_MAX_ITEMS,
  STATIC_LIST_MAX_OBJECT_BYTES,
  capStaticListTotal,
  rebuildTarget,
  removeTrackedArtifacts,
} from "./rebuild.ts";
import { PUBLIC_LISTABLE_X_APPROVAL_SQL_IN } from "../../src/lib/utils/publicXUser.ts";

const source = await readFile(new URL("./rebuild.ts", import.meta.url), "utf8");
const projectionSource = await readFile(
  new URL("../../src/lib/publicData/publicCreatorProjection.ts", import.meta.url),
  "utf8",
);

function statement(sql, state) {
  return {
    bind(...args) {
      state.binds.push({ sql, args });
      return this;
    },
    async first() {
      return state.first(sql);
    },
    async all() {
      return state.all(sql);
    },
    async run() {
      state.runs.push(sql);
      return { meta: { changes: 1 } };
    },
  };
}

function videoEnv({ visibility = "public", youtubeId = "new-youtube" } = {}) {
  const state = { binds: [], runs: [], first: () => null, all: () => ({ results: [] }) };
  state.first = (sql) => sql.includes("FROM videos")
    ? { id: "video-1", visibility_status: visibility, youtube_video_id: youtubeId, updated_at: 123 }
    : null;
  state.all = (sql) => sql.includes("FROM static_artifacts")
    ? { results: [{ object_key: "videos/old-youtube.json" }] }
    : { results: [] };
  const puts = [];
  const deletes = [];
  return {
    state,
    puts,
    deletes,
    DB: { prepare: (sql) => statement(sql, state) },
    R2: {
      async get(key) {
        if (
          key ===
          "youtube/related-blocklist.v1.json"
        ) {
          return {
            async json() {
              return {
                schema_version: 1,
                generated_at: 1,
                blocked: {},
              };
            },
          };
        }

        if (
          key ===
          "videos/random-pool.v1.json"
        ) {
          return {
            async json() {
              return {
                schema_version: 1,
                generated_at: 1,
                generation_key:
                  "generation-1",
                items: [
                  {
                    id: "video-2",
                    title: "Video 2",
                    youtube_video_id:
                      "youtube-2",
                    display_name:
                      "Creator 2",
                    icon_url: null,
                    creator_x_user_id:
                      "creator-2",
                    primary_event_id:
                      null,
                    scheduled_time:
                      null,
                  },
                ],
              };
            },
          };
        }

        return null;
      },
      async put(key) { puts.push(key); },
      async delete(key) { deletes.push(key); },
    },
    KV: { put: async () => {} },
  };
}

function eventEnv({ visibility = "public" } = {}) {
  const state = { binds: [], runs: [], first: () => null, all: () => ({ results: [] }) };
  state.first = (sql) => sql.includes("FROM events")
    ? { id: "event-1", visibility_status: visibility, updated_at: 456 }
    : null;
  state.all = (sql) => sql.includes("FROM static_artifacts")
    ? { results: [{ object_key: "events/event-1.json" }] }
    : { results: [] };
  const puts = [];
  const deletes = [];
  return {
    state,
    puts,
    deletes,
    DB: { prepare: (sql) => statement(sql, state) },
    R2: {
      async put(key) { puts.push(key); },
      async delete(key) { deletes.push(key); },
    },
    KV: { put: async () => {} },
  };
}

test("非公開化は静的JSONを再生成せず、追跡artifactを削除する", async () => {
  const env = videoEnv({ visibility: "private" });
  await rebuildTarget(env, "video", "video-1");
  assert.deepEqual(env.puts, []);
  assert.deepEqual(env.deletes, ["videos/old-youtube.json"]);
  assert.equal(env.state.runs.filter((sql) => sql.includes("SET deleted_at")).length, 1);
});

test("旧archivedイベントは公開対象にせずartifactを削除する", async () => {
  const env = eventEnv({ visibility: "archived" });
  await rebuildTarget(env, "event", "event-1");
  assert.deepEqual(env.puts, []);
  assert.deepEqual(env.deletes, ["events/event-1.json"]);
});

test("旧limited作品は公開対象にせずartifactを削除する", async () => {
  const env = videoEnv({ visibility: "limited" });
  await rebuildTarget(env, "video", "video-1");
  assert.deepEqual(env.puts, []);
  assert.deepEqual(env.deletes, ["videos/old-youtube.json"]);
});

test("YouTube ID変更は新keyを生成し、旧keyを追跡削除する", async () => {
  const env = videoEnv({ youtubeId: "new-youtube" });
  await rebuildTarget(env, "video", "video-1");
  assert.deepEqual(env.puts, ["videos/video-1.json", "videos/new-youtube.json"]);
  assert.deepEqual(env.deletes, ["videos/old-youtube.json"]);
  assert.ok(env.state.runs.some((sql) => sql.includes("INSERT INTO static_artifacts")));
});

test("R2 delete失敗時はdeleted_atを更新せず、再試行成功後にだけ更新する", async () => {
  let attempts = 0;
  const state = { binds: [], runs: [], first: () => null, all: () => ({ results: [{ object_key: "videos/old.json" }] }) };
  const env = {
    DB: { prepare: (sql) => statement(sql, state) },
    R2: {
      async delete() {
        attempts += 1;
        if (attempts === 1) throw new Error("temporary R2 failure");
      },
    },
  };
  await assert.rejects(() => removeTrackedArtifacts(env, "video", "video-1"));
  assert.equal(state.runs.filter((sql) => sql.includes("SET deleted_at")).length, 0);
  await removeTrackedArtifacts(env, "video", "video-1");
  assert.equal(state.runs.filter((sql) => sql.includes("SET deleted_at")).length, 1);
});

test("public creator queries include imported legacy X IDs", () => {
  assert.ok(PUBLIC_LISTABLE_X_APPROVAL_SQL_IN.includes("'imported'"));
  assert.match(
    projectionSource,
    /WHERE approval_status IN \(\$\{PUBLIC_LISTABLE_X_APPROVAL_SQL_IN\}\)/,
  );
  assert.match(
    source,
    /WHERE approval_status IN \(\$\{PUBLIC_LISTABLE_X_APPROVAL_SQL_IN\}\)/,
  );
  assert.match(
    source,
    /FROM x_users WHERE id = \? AND approval_status IN \(\$\{PUBLIC_LISTABLE_X_APPROVAL_SQL_IN\}\) LIMIT 1/,
  );
});

test("static JSON queryはcanonical列だけを使う", () => {
  assert.doesNotMatch(source, /max_consecutive_slots_per_entry/);
  assert.doesNotMatch(source, /es\.role/);
  assert.doesNotMatch(source, /other_social_links, updated_at/);
  assert.doesNotMatch(source, /xu\.(updated_at|created_at)/);
  assert.doesNotMatch(source, /x_users\.(updated_at|created_at)/);
  assert.match(source, /staticArtifactContentHash\(body\)/);
});

test("public static JSON queries exclude private event relations", () => {
  assert.match(
    source,
    /buildHeroEventSlotStatsSql\(heroEventIds\)/,
  );
  assert.doesNotMatch(
    source,
    /FROM slots AS s[\s\S]*GROUP BY s\.event_id[\s\S]*async function rebuildListRecent/,
  );
  assert.ok(
    (source.match(/THEN v\.primary_event_id ELSE NULL END AS primary_event_id/g) ?? [])
      .length >= 4,
  );
  assert.match(
    source,
    /e\.id AS primary_event_id[\s\S]*LEFT JOIN events e[\s\S]*e\.visibility_status = 'public'/,
  );
  assert.match(
    source,
    /SELECT ve\.event_id[\s\S]*INNER JOIN events AS e[\s\S]*e\.visibility_status = 'public'/,
  );
  assert.match(source, /software_labels/);
  assert.match(source, /public_chapters/);
  assert.match(source, /member_chapters/);
  assert.match(source, /related_videos/);
  assert.match(source, /app_like_count/);
});

test("event groupとjunctionの取得件数を固定する", () => {
  assert.equal(EVENTS_INDEX_MAX_ROWS, 200);
  assert.equal(EVENT_GROUP_MAX_ROWS, 50);
  assert.equal(EVENT_GROUP_EVENT_MAX_PER_GROUP, 20);
  assert.equal(EVENT_GROUP_EVENT_MAX_ROWS, 1000);
  assert.match(source, /FROM event_groups[\s\S]*ORDER BY sort_order ASC, name ASC[\s\S]*LIMIT \?/);
  assert.match(source, /ROW_NUMBER\(\) OVER \([\s\S]*PARTITION BY ege\.event_group_id/);
  assert.match(source, /WHERE group_rank <= \?[\s\S]*LIMIT \?/);
});

test("events index と event group は点イベントを除外する", () => {
  const nonPointFilters = source.match(/\$\{NON_POINT_EVENT_PERIOD_SQL\}/g) ?? [];
  assert.equal(nonPointFilters.length, 4);

  const eventsIndexFn = source.match(
    /async function rebuildEventsIndex[\s\S]*?(?=async function )/,
  )?.[0];
  assert.ok(eventsIndexFn);
  assert.match(eventsIndexFn, /FROM events[\s\S]*NON_POINT_EVENT_PERIOD_SQL/);

  const eventGroupFn = source.match(
    /async function rebuildEventGroupSections[\s\S]*?(?=\nfunction |\nasync function )/,
  )?.[0];
  assert.ok(eventGroupFn);
  assert.match(
    eventGroupFn,
    /INNER JOIN events e[\s\S]*NON_POINT_EVENT_PERIOD_SQL/,
  );
});

test("list_popularはrecent相当の公開カード列とtotalを返す", () => {
  const popularFn = source.match(
    /async function rebuildListPopular[\s\S]*?(?=async function )/,
  )?.[0];
  assert.ok(popularFn);
  assert.equal(STATIC_LIST_MAX_ITEMS, 5000);
  assert.equal(RECENT_LIST_LIMIT, STATIC_LIST_MAX_ITEMS);
  assert.equal(POPULAR_LIST_LIMIT, STATIC_LIST_MAX_ITEMS);
  assert.equal(SEARCH_INDEX_VIDEO_LIMIT, STATIC_LIST_MAX_ITEMS);
  assert.match(source, /STATIC_LIST_VIDEO_SELECT[\s\S]*creator_x_user_id/);
  assert.match(source, /STATIC_LIST_VIDEO_SELECT[\s\S]*primary_event_title/);
  assert.match(source, /STATIC_LIST_VIDEO_SELECT[\s\S]*visibility_status AS status/);
  assert.match(popularFn, /WHERE \$\{COUNTABLE_PUBLIC_VIDEO_SQL\}/);
  assert.match(
    popularFn,
    /SELECT COUNT\(\*\) AS c FROM videos AS v WHERE \$\{COUNTABLE_PUBLIC_VIDEO_SQL\}/,
  );
  assert.match(popularFn, /total: capStaticListTotal\(counted, items\)/);
});

test("list_recentもCOUNTABLE公開条件でPVSFサマリーを除外する", () => {
  const recentFn = source.match(
    /async function rebuildListRecent[\s\S]*?(?=async function )/,
  )?.[0];
  assert.ok(recentFn);
  assert.match(recentFn, /WHERE \$\{COUNTABLE_PUBLIC_VIDEO_SQL\}/);
  assert.match(
    recentFn,
    /SELECT COUNT\(\*\) AS c FROM videos AS v WHERE \$\{COUNTABLE_PUBLIC_VIDEO_SQL\}/,
  );
  assert.match(recentFn, /LIMIT \?/);
  assert.match(recentFn, /\.bind\(RECENT_LIST_LIMIT\)/);
  assert.match(recentFn, /total: capStaticListTotal\(counted, items\)/);
  assert.match(recentFn, /assertStaticListObjectSize\("list\/recent\.json"/);
});

test("capStaticListTotal rejects non-finite and negative totals", () => {
  assert.equal(capStaticListTotal(100, [{ id: "v1" }, { id: "v2" }]), 2);
  assert.equal(capStaticListTotal(Number.NaN, [{ id: "v1" }]), 1);
  assert.equal(capStaticListTotal(Number.POSITIVE_INFINITY, [{ id: "v1" }]), 1);
  assert.equal(capStaticListTotal(-5, [{ id: "v1" }, { id: "v2" }]), 2);
});

test("list artifacts enforce STATIC_LIST_MAX_OBJECT_BYTES before put", () => {
  assert.equal(STATIC_LIST_MAX_OBJECT_BYTES, 8 * 1024 * 1024);
  assert.match(source, /assertStaticListObjectSize\("list\/recent\.json"/);
  assert.match(source, /assertStaticListObjectSize\("list\/popular\.json"/);
  assert.match(source, /assertStaticListObjectSize\("search-index-lite\.json"/);
});

test("search-index-liteのvideosはCOUNTABLE条件でSTATIC_LIST_MAX_ITEMS件まで取得する", () => {
  const searchFn = source.match(
    /async function rebuildSearchIndexLite[\s\S]*?(?=async function )/,
  )?.[0];
  assert.ok(searchFn);
  assert.match(searchFn, /WHERE \$\{COUNTABLE_PUBLIC_VIDEO_SQL\}/);
  assert.match(searchFn, /ORDER BY v\.updated_at DESC/);
  assert.match(searchFn, /LIMIT \?/);
  assert.match(searchFn, /\.bind\(SEARCH_INDEX_VIDEO_LIMIT\)/);
  assert.match(searchFn, /ORDER BY id ASC LIMIT 500/);
});

test("rebuildEventはD1公開詳細相当の作品紐付けと集計を使う", () => {
  const eventFn = source.match(
    /async function rebuildEvent\(env[\s\S]*?(?=type StaticRelatedVideoRow)/,
  )?.[0];
  assert.ok(eventFn);
  assert.match(source, /function eventPublicVideoWhereSql/);
  assert.match(source, /eventPublicVideoWhereSql[\s\S]*primary_event_id = \?/);
  assert.match(source, /eventPublicVideoWhereSql[\s\S]*PVSF_SUMMARY_EVENT_ID/);
  assert.match(eventFn, /video_total:/);
  assert.match(eventFn, /creator_count:/);
  assert.match(eventFn, /slots: publicSlots/);
  const slotsQuery = eventFn.match(
    /`SELECT id, status, start_time, sort_order[\s\S]*?FROM slots[\s\S]*?`/,
  )?.[0];
  assert.ok(slotsQuery);
  assert.doesNotMatch(slotsQuery, /display_name/);
  assert.doesNotMatch(slotsQuery, /reserved_by_user_id/);
  assert.match(source, /EVENT_DETAIL_COLUMNS[\s\S]*slot_part_gap_minutes/);
  assert.match(eventFn, /creator_x_user_id/);
});

test("rebuildUsersIndexはCreator Projectionを使い相関サブクエリを持たない", () => {
  const usersIndexFn = source.match(
    /async function rebuildUsersIndex[\s\S]*?(?=async function )/,
  )?.[0];
  assert.ok(usersIndexFn);
  assert.match(usersIndexFn, /loadPublicCreatorProjectionSources/);
  assert.match(usersIndexFn, /buildPublicUsersIndexItems/);
  assert.match(usersIndexFn, /USERS_INDEX_MAX_OBJECT_BYTES/);
  assert.doesNotMatch(usersIndexFn, /SELECT COUNT\(DISTINCT v\.id\)/);
});

test("rebuildTopとrebuildRecommendはCreator Projectionを再利用する", () => {
  const topFn = source.match(/async function rebuildTop[\s\S]*?(?=async function )/)?.[0];
  const recommendFn = source.match(
    /async function rebuildRecommend[\s\S]*?(?=async function )/,
  )?.[0];
  assert.ok(topFn);
  assert.ok(recommendFn);
  assert.match(topFn, /loadPublicCreatorProjectionSources/);
  assert.match(recommendFn, /loadPublicCreatorProjectionSources/);
  assert.match(topFn, /buildPickupCreatorsFromProjection/);
  assert.match(recommendFn, /buildPickupCreatorsFromProjection/);
  assert.doesNotMatch(topFn, /WITH creator_counts AS/);
  assert.doesNotMatch(recommendFn, /WITH creator_counts AS/);
});

test("rebuildTopのPromise.all分割代入はpublicEventCountを含む", () => {
  const topFn = source.match(
    /async function rebuildTop[\s\S]*?(?=async function )/,
  )?.[0];
  assert.ok(topFn);
  const destructuring = topFn.match(
    /const \[([\s\S]*?)\] = await Promise\.all\(\[/,
  )?.[1];
  assert.ok(destructuring);
  assert.match(destructuring, /publicEventCount/);
  assert.match(destructuring, /nostalgic/);
  assert.match(
    topFn,
    /public_events: Number\(publicEventCount\?\.c/,
  );
});

test("rebuildTopは新着100件と3年以上前のYouTube確認済みプールから日次シャッフル用に保存する", () => {
  const topFn = source.match(
    /async function rebuildTop[\s\S]*?(?=async function )/,
  )?.[0];
  assert.ok(topFn);
  assert.match(source, /TOP_LATEST_LIMIT = 100/);
  assert.match(source, /TOP_NOSTALGIA_LIMIT = 20/);
  assert.match(source, /TOP_NOSTALGIA_POOL = 200/);
  assert.match(topFn, /const nostalgiaCutoff = unixYearsAgo\(now, 3\)/);
  assert.match(topFn, /v\.scheduled_time <= \?/);
  assert.match(topFn, /YOUTUBE_SYNCED_PLAYABLE_SQL/);
  assert.match(topFn, /ORDER BY scheduled_time ASC, id ASC/);
  assert.match(topFn, /LIMIT \$\{TOP_NOSTALGIA_POOL\}/);
  assert.doesNotMatch(topFn, /ORDER BY RANDOM\(\)/);
  assert.match(source, /pickNostalgicDisplay/);
  assert.match(topFn, /nostalgic_pool: nostalgicPool/);
  assert.match(
    topFn,
    /nostalgic: pickNostalgicDisplay\(nostalgicPool, TOP_NOSTALGIA_LIMIT\)/,
  );
  assert.match(topFn, /nostalgic_shuffled_at: now/);
});

test("ensureDailyTopNostalgicShuffleはUTC日次でtop再生成をキュー登録する", () => {
  const fn = source.match(
    /export async function ensureDailyTopNostalgicShuffle[\s\S]*?(?=\/\*\*|export async function |async function )/,
  )?.[0];
  assert.ok(fn);
  assert.match(fn, /TOP_NOSTALGIC_SHUFFLE_DAY_KV_KEY/);
  assert.match(fn, /enqueueTopRebuild/);
  assert.match(fn, /nostalgic_daily_shuffle/);
  assert.doesNotMatch(fn, /JSON\.parse/);
  assert.doesNotMatch(fn, /env\.R2\.get\("top\.json"\)/);
});

test("rebuildTopはヒーローイベントのslot_statsだけを集計する", async () => {
  const now = Math.floor(Date.now() / 1000);
  const heroIds = ["hero-1", "hero-2"];
  const slotQueries = [];
  const state = {
    binds: [],
    runs: [],
    first() {
      return null;
    },
    all(sql) {
      if (sql.includes("FROM slots AS s") && sql.includes("GROUP BY s.event_id")) {
        slotQueries.push({ sql, args: state.binds.at(-1)?.args ?? [] });
        return {
          results: heroIds.map((eventId) => ({
            event_id: eventId,
            available: 2,
            total: 5,
          })),
        };
      }
      if (sql.includes("FROM events") && sql.includes("visibility_status = 'public'")) {
        return {
          results: [
            ...heroIds.map((id, index) => ({
              id,
              title: `Event ${id}`,
              visibility_status: "public",
              start_time: now + 1000 + index * 1000,
              end_time: now + 10_000 + index * 1000,
              entry_start_time: null,
              entry_end_time: null,
              created_at: now - 86400,
            })),
            {
              id: "other-event",
              title: "Other",
              visibility_status: "public",
              start_time: now + 100_000,
              end_time: null,
              entry_start_time: null,
              entry_end_time: null,
              created_at: now - 86400,
            },
          ],
        };
      }
      return { results: [] };
    },
  };
  const puts = [];
  const env = {
    DB: {
      prepare: (sql) => statement(sql, state),
    },
    R2: {
      async put(key, body) {
        puts.push({ key, body: JSON.parse(String(body)) });
      },
      delete: async () => {},
    },
    KV: { put: async () => {} },
  };

  await rebuildTarget(env, "top", "global");

  assert.equal(slotQueries.length, 1);
  assert.deepEqual(slotQueries[0].args, heroIds);
  assert.match(slotQueries[0].sql, /WHERE s\.event_id IN/);
  const top = puts.find((entry) => entry.key === "top.json");
  assert.ok(top);
  assert.equal(top.body.slot_stats.length, 2);
  assert.ok(top.body.slot_stats.every((row) => heroIds.includes(row.event_id)));
  assert.ok(top.body.slot_stats.every((row) => row.event_id !== "other-event"));
});

test("rebuildTopはpublicEventCount由来のstats.public_eventsを返す", async () => {
  const state = {
    binds: [],
    runs: [],
    first(sql) {
      if (sql.includes("FROM events") && sql.includes("visibility_status = 'public'") && sql.includes("COUNT(*)")) {
        return { c: 7 };
      }
      if (sql.includes("FROM videos") && sql.includes("COUNT(*)")) {
        return { c: 3 };
      }
      if (sql.includes("FROM x_users") && sql.includes("COUNT(*)")) {
        return { c: 2 };
      }
      return null;
    },
    all: () => ({ results: [] }),
  };
  const puts = [];
  const env = {
    DB: { prepare: (sql) => statement(sql, state) },
    R2: {
      async put(key, body) {
        puts.push({ key, body: JSON.parse(String(body)) });
      },
      delete: async () => {},
    },
    KV: { put: async () => {} },
  };

  await rebuildTarget(env, "top", "global");

  const top = puts.find((entry) => entry.key === "top.json");
  assert.ok(top);
  assert.equal(top.body.stats.public_events, 7);
});

test("rebuildUsersIndex成功後にtop/recommend follow-upをenqueueする", () => {
  assert.match(source, /case "users_index":[\s\S]*enqueueTopRecommendAfterUsersIndex/);
});

test("200イベントの公開運営取得はD1 bind上限未満にchunkする", async () => {
  const eventRows = Array.from({ length: EVENTS_INDEX_MAX_ROWS }, (_, index) => ({
    id: `event-${index + 1}`,
  }));
  const state = {
    binds: [],
    runs: [],
    first: () => null,
    all(sql) {
      if (sql.includes("FROM events") && !sql.includes("event_group_events")) {
        return { results: eventRows };
      }
      return { results: [] };
    },
  };
  const env = {
    DB: { prepare: (sql) => statement(sql, state) },
    R2: { put: async () => ({}), delete: async () => {} },
    KV: { put: async () => {} },
  };

  await rebuildTarget(env, "events_index", "global");

  const staffQueries = state.binds.filter(({ sql }) =>
    sql.includes("ranked_public_staff"),
  );
  assert.equal(PUBLIC_STAFF_EVENT_ID_CHUNK_SIZE, 90);
  assert.equal(PUBLIC_STAFF_MAX_PER_EVENT, 20);
  assert.equal(staffQueries.length, 3);
  assert.ok(
    staffQueries.every(({ args }) =>
      args.length <= PUBLIC_STAFF_EVENT_ID_CHUNK_SIZE + 1),
  );
  assert.ok(staffQueries.every(({ args }) => args.at(-1) === PUBLIC_STAFF_MAX_PER_EVENT));
});

test("video v2生成はblocklist欠損時に既存JSONを上書きしない", async () => {
  const env = videoEnv();

  env.R2.get = async (key) => {
    if (
      key ===
      "videos/random-pool.v1.json"
    ) {
      return {
        async json() {
          return {
            schema_version: 1,
            generated_at: 1,
            generation_key: "generation-1",
            items: [
              {
                id: "video-2",
                title: "Video 2",
                youtube_video_id: "youtube-2",
                display_name: "Creator 2",
                icon_url: null,
                creator_x_user_id: "creator-2",
                primary_event_id: null,
                scheduled_time: null,
              },
            ],
          };
        },
      };
    }

    return null;
  };

  await assert.rejects(
    () =>
      rebuildTarget(
        env,
        "video",
        "video-1",
      ),
    /youtube_related_blocklist_required_for_static_generation/,
  );

  assert.deepEqual(env.puts, []);
});

test("関連動画生成は共有メンバー識別子を正規化後も保持する", () => {
  assert.match(
    source,
    /member_x_user_id:[\s\S]*trim\(\)\.toLowerCase\(\)/,
  );
  assert.match(
    source,
    /const memberId = row\.member_x_user_id/,
  );
  assert.doesNotMatch(
    source,
    /SELECT LOWER\(vm\.x_user_id\) AS member_x_user_id[\s\S]*WHERE vm\.video_id = \?/,
  );
});

test("関連動画はprimaryとreserveを別々に生成する", () => {
  assert.match(
    source,
    /type StaticRelatedVideoSelection/,
  );
  assert.match(
    source,
    /targetCount = relatedLimit \+ RELATED_RESERVE_LIMIT/,
  );
  assert.match(
    source,
    /reserveRows[\s\S]*slice\(0, RELATED_RESERVE_LIMIT\)/,
  );
});

test("ユーザー合作取得はJOIN重複ではなくEXISTSを使う", () => {
  const userFn = source.match(
    /async function rebuildUser\([\s\S]*?(?=\nasync function |\nfunction |$)/,
  )?.[0];

  assert.ok(userFn);
  assert.match(
    userFn,
    /EXISTS \([\s\S]*FROM video_members AS vm[\s\S]*vm\.video_id = v\.id/,
  );
  assert.doesNotMatch(
    userFn,
    /INNER JOIN video_members AS vm ON vm\.video_id = v\.id/,
  );
});

test("関連blocklistはFlameNode非公開とYouTube非公開を遮断する", () => {
  const blocklistFn = source.match(
    /async function rebuildYoutubeRelatedBlocklist[\s\S]*?(?=\nasync function )/,
  )?.[0];

  assert.ok(blocklistFn);
  assert.match(
    blocklistFn,
    /LEFT JOIN video_youtube_metadata/,
  );
  assert.match(
    blocklistFn,
    /v\.visibility_status <> 'public'/,
  );
  assert.match(
    blocklistFn,
    /youtube_privacy_status = 'private'/,
  );
  assert.match(
    blocklistFn,
    /missing_or_private/,
  );
});

test("random poolはR2 blocklistへ依存せずD1で対象を除外する", () => {
  const randomPoolFn = source.match(
    /async function rebuildRandomVideoPool[\s\S]*?(?=\nasync function )/,
  )?.[0];

  assert.ok(randomPoolFn);
  assert.doesNotMatch(
    randomPoolFn,
    /loadWorkerRelatedBlocklist/,
  );
  assert.match(
    randomPoolFn,
    /NOT EXISTS \([\s\S]*video_youtube_metadata/,
  );
});

test("通常チャプターとメンバーチャプターは別queryで取得する", () => {
  const videoFn = source.match(
    /async function rebuildVideo[\s\S]*?(?=\nasync function rebuildUsersIndex)/,
  )?.[0];

  assert.ok(videoFn);
  assert.match(
    videoFn,
    /vc\.id NOT LIKE '%:member:%'/,
  );
  assert.match(
    videoFn,
    /vc\.id LIKE '%:member:%'/,
  );
  assert.match(
    videoFn,
    /chapters: \(memberChapters\.results/,
  );
  assert.doesNotMatch(
    videoFn,
    /allPublicChapters/,
  );
});
