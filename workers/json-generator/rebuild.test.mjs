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
  ensureDailyTopNostalgicShuffle,
  rebuildTarget,
  removeTrackedArtifacts,
} from "./rebuild.ts";
import { PUBLIC_LISTABLE_X_APPROVAL_SQL_IN } from "../../src/lib/utils/publicXUser.ts";
import { PICKUP_CREATORS_OBJECT_KEY } from "../../src/lib/publicData/publicCreatorProjection.ts";

const source = await readFile(new URL("./rebuild.ts", import.meta.url), "utf8");
const projectionSource = await readFile(
  new URL("../../src/lib/publicData/publicCreatorProjection.ts", import.meta.url),
  "utf8",
);

test("通常putJsonはR2 dedupe後もstatic_artifacts追跡を更新する", () => {
  const start = source.indexOf("async function putJson(");
  const end = source.indexOf("\nasync function recordArtifact(", start);
  const body = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(body, /const identical = await resolveIdenticalJsonArtifactPut/);
  assert.match(body, /if \(!identical\) \{[\s\S]*await env\.R2\.put/);
  assert.match(body, /if \(target\) await recordArtifact/);
  assert.ok(
    body.indexOf("await recordArtifact") > body.indexOf("if (!identical)"),
    "artifact tracking must run after the optional R2 PUT",
  );
  assert.doesNotMatch(body, /if \(await resolveIdenticalJsonArtifactPut[\s\S]*\) \{\s*return;/);
});

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
  assert.ok(env.deletes.includes("events/event-1.json"));
  assert.ok(env.deletes.includes("events/event-1/base.v1.json"));
  assert.ok(env.deletes.includes("events/event-1/slots.v1.json"));
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
    /SELECT e\.id, e\.title[\s\S]*FROM events AS e[\s\S]*e\.visibility_status = 'public'[\s\S]*EXISTS \([\s\S]*FROM video_events AS ve[\s\S]*OR e\.id = \?/,
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
  assert.doesNotMatch(
    popularFn,
    /SELECT COUNT\(\*\) AS c FROM videos AS v WHERE \$\{COUNTABLE_PUBLIC_VIDEO_SQL\}/,
  );
  assert.match(popularFn, /total: capStaticListTotal\(items\.length, items\)/);
});

test("list_recentもCOUNTABLE公開条件でPVSFサマリーを除外する", () => {
  const recentFn = source.match(
    /async function rebuildListRecent[\s\S]*?(?=async function )/,
  )?.[0];
  assert.ok(recentFn);
  assert.match(recentFn, /WHERE \$\{COUNTABLE_PUBLIC_VIDEO_SQL\}/);
  assert.doesNotMatch(
    recentFn,
    /SELECT COUNT\(\*\) AS c FROM videos AS v WHERE \$\{COUNTABLE_PUBLIC_VIDEO_SQL\}/,
  );
  assert.match(recentFn, /LIMIT \?/);
  assert.match(recentFn, /\.bind\(RECENT_LIST_LIMIT\)/);
  assert.match(recentFn, /total: capStaticListTotal\(items\.length, items\)/);
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

test("search-indexはgeneration固定のbounded posting shardも生成する", () => {
  assert.match(source, /buildStaticVideoSearchPostingArtifacts/);
  assert.match(source, /staticVideoSearchPostingManifestObjectKey/);
  assert.match(source, /staticVideoSearchPostingDirectoryObjectKey/);
  assert.match(source, /staticVideoSearchPostingPageObjectKey/);
  assert.match(source, /recordArtifactsBatch/);
  assert.match(source, /FROM json_each\(\?\)/);
  assert.match(source, /await reconcileTrackedArtifacts\(/);
});

test("search-indexのposting trackingは生成関数自身が完了するため共通cleanupで削除しない", () => {
  const rebuildTargetTail = source.slice(source.indexOf("export async function rebuildTarget"));
  const cleanupBlock = rebuildTargetTail.match(
    /if \(\[\s*[\s\S]*?\]\.includes\(targetType\)\) \{[\s\S]*?await reconcileTrackedArtifacts\(/,
  )?.[0];
  assert.ok(cleanupBlock);
  assert.doesNotMatch(cleanupBlock, /"search_index"/);
  assert.doesNotMatch(cleanupBlock, /search-index-lite\.json/);
});

test("rebuildEventBaseはD1公開詳細相当の作品紐付けと集計を使う", () => {
  const eventFn = source.match(
    /async function rebuildEventBase\([\s\S]*?(?=async function rebuildEventSlots)/,
  )?.[0];
  assert.ok(eventFn);
  assert.match(source, /function eventPublicVideoWhereSql/);
  assert.match(source, /eventPublicVideoWhereSql[\s\S]*primary_event_id = \?/);
  assert.match(source, /eventPublicVideoWhereSql[\s\S]*PVSF_SUMMARY_EVENT_ID/);
  assert.match(eventFn, /video_total:/);
  assert.match(eventFn, /creator_count:/);
  assert.match(eventFn, /LIMIT 501/);
  assert.doesNotMatch(eventFn, /FROM slots/);
  assert.match(source, /EVENT_DETAIL_COLUMNS[\s\S]*slot_part_gap_minutes/);
  assert.match(eventFn, /creator_x_user_id/);
  assert.match(eventFn, /COALESCE\(v\.score, 0\) AS score/);
});

test("rebuildEventSlotsはslots 1 queryとJS summaryを使う", () => {
  const slotsFn = source.match(
    /async function rebuildEventSlots\([\s\S]*?(?=async function rebuildEvent\()/,
  )?.[0];
  assert.ok(slotsFn);
  assert.match(slotsFn, /buildEventSlotsSummary/);
  assert.match(slotsFn, /slots_summary:/);
  const slotsQuery = slotsFn.match(
    /`SELECT id, status, start_time, sort_order[\s\S]*?FROM slots[\s\S]*?`/,
  )?.[0];
  assert.ok(slotsQuery);
  assert.doesNotMatch(slotsQuery, /display_name/);
  assert.doesNotMatch(slotsQuery, /reserved_by_user_id/);
  assert.doesNotMatch(slotsFn, /GROUP BY status/);
});

test("rebuildEventReleaseは公開動画を500件・公開メンバーを100件へbounded projectionする", () => {
  const block = source.slice(source.indexOf("async function rebuildEventRelease"), source.indexOf("function stripEventPublicVideoScore"));
  assert.match(block, /vm\.is_public_member = 1/);
  assert.match(block, /LIMIT \$\{EVENT_RELEASE_MAX_VIDEOS \+ 1\}/);
  assert.match(block, /EVENT_RELEASE_MAX_MEMBERS_PER_VIDEO/);
  assert.match(block, /targetType: "event_release"/);
  assert.match(source, /case "event_release"/);
});

test("rebuildEvent composerはR2 base/slotsのみでevents/{id}.jsonを書く", () => {
  const eventFn = source.match(
    /async function rebuildEvent\([\s\S]*?(?=type StaticRelatedVideoRow)/,
  )?.[0];
  assert.ok(eventFn);
  assert.match(eventFn, /loadWorkerR2Json\(env, baseKey/);
  assert.match(eventFn, /loadWorkerR2Json\(env, slotsKey/);
  assert.match(eventFn, /event_composer_required_section_missing:base/);
  assert.match(eventFn, /event_composer_required_section_missing:slots/);
  assert.doesNotMatch(eventFn, /FROM videos AS v/);
  assert.doesNotMatch(eventFn, /FROM slots/);
  assert.match(eventFn, /stripEventPublicVideoScore/);
});

test("putJson は同一 hash のとき R2 PUT と static_artifacts UPSERT を省略する", () => {
  const putJsonFn = source.match(
    /async function putJson\([\s\S]*?(?=async function recordArtifact)/,
  )?.[0];
  assert.ok(putJsonFn);
  assert.match(putJsonFn, /resolveIdenticalJsonArtifactPut/);
  assert.match(putJsonFn, /if \(target\) await recordArtifact/);
});

test("rebuildUsersIndexはCreator Projectionを使い3 artifactを書く", () => {
  const usersIndexFn = source.match(
    /async function rebuildUsersIndex[\s\S]*?(?=async function )/,
  )?.[0];
  assert.ok(usersIndexFn);
  assert.match(usersIndexFn, /loadPublicCreatorProjectionSources/);
  assert.match(usersIndexFn, /buildPublicUsersIndexItems/);
  assert.match(usersIndexFn, /USERS_INDEX_MAX_OBJECT_BYTES/);
  assert.match(usersIndexFn, /buildPickupCreatorsArtifactFromProjection/);
  assert.match(usersIndexFn, /PICKUP_CREATORS_OBJECT_KEY/);
  assert.match(usersIndexFn, /PUBLIC_X_ICON_MAP_OBJECT_KEY/);
  assert.doesNotMatch(usersIndexFn, /SELECT COUNT\(DISTINCT v\.id\)/);
});

test("rebuildTop composerはR2 sectionとpickup creatorsのみでtop.jsonを書く", () => {
  const topFn = source.match(/async function rebuildTop\(env[\s\S]*?(?=\/\*\*|export async function |async function )/)?.[0];
  assert.ok(topFn);
  assert.match(topFn, /loadRequiredTopSection/);
  assert.match(topFn, /resolvePickupCreatorsWithFallback\(env, 30/);
  assert.match(topFn, /normalizeStaticTopSlotStats/);
  assert.doesNotMatch(topFn, /env\.DB\.prepare\([\s\S]*FROM videos AS v[\s\S]*ORDER BY COALESCE\(score, 0\)/);
  assert.doesNotMatch(topFn, /putTopSlotStatsArtifact/);
  assert.doesNotMatch(topFn, /env\.KV\.put/);
});

test("rebuildTopStatsはpublicEventCount由来のstats.public_eventsを書く", () => {
  const statsFn = source.match(
    /async function rebuildTopStats\(env[\s\S]*?(?=async function )/,
  )?.[0];
  assert.ok(statsFn);
  assert.match(statsFn, /public_events: Number\(publicEventCount/);
});

test("rebuildRecommendCoreはD1 video queryのみでcore artifactを書く", () => {
  const coreFn = source.match(
    /async function rebuildRecommendCore\(env[\s\S]*?(?=async function )/,
  )?.[0];
  assert.ok(coreFn);
  assert.match(coreFn, /COUNTABLE_PUBLIC_VIDEO_SQL/);
  assert.match(coreFn, /RECOMMEND_CORE_OBJECT_KEY/);
  assert.doesNotMatch(coreFn, /resolvePickupCreatorsWithFallback/);
  assert.doesNotMatch(coreFn, /loadPublicCreatorProjectionSources\(env\.DB/);
});

test("rebuildRecommend composerはR2 coreとpickup creatorsのみでrecommend.jsonを書く", () => {
  const recommendFn = source.match(
    /async function rebuildRecommend\(env[\s\S]*?(?=async function )/,
  )?.[0];
  assert.ok(recommendFn);
  assert.match(recommendFn, /loadWorkerR2Json\(env, RECOMMEND_CORE_OBJECT_KEY/);
  assert.match(recommendFn, /normalizeRecommendCore/);
  assert.match(recommendFn, /recommend_core_required_for_recommend_composer/);
  assert.match(recommendFn, /resolvePickupCreatorsWithFallback\(env, 60/);
  assert.doesNotMatch(recommendFn, /COUNTABLE_PUBLIC_VIDEO_SQL/);
  assert.doesNotMatch(recommendFn, /loadPublicCreatorProjectionSources\(env\.DB/);
});

test("rebuildTopStatsのPromise.all分割代入はpublicEventCountを含む", () => {
  const statsFn = source.match(
    /async function rebuildTopStats\(env[\s\S]*?(?=async function )/,
  )?.[0];
  assert.ok(statsFn);
  const destructuring = statsFn.match(
    /const \[([\s\S]*?)\] = await Promise\.all\(\[/,
  )?.[1];
  assert.ok(destructuring);
  assert.match(destructuring, /publicEventCount/);
});

test("rebuildTopRecommended/rebuildTopLatest/loadTopNostalgicPoolはCOUNTABLE_PUBLIC_VIDEO_SQLで候補を絞る", () => {
  const recommendedFn = source.match(
    /async function rebuildTopRecommended\(env[\s\S]*?(?=async function )/,
  )?.[0];
  const latestFn = source.match(
    /async function rebuildTopLatest\(env[\s\S]*?(?=async function )/,
  )?.[0];
  const poolFn = source.match(
    /async function loadTopNostalgicPool[\s\S]*?(?=async function )/,
  )?.[0];
  assert.ok(recommendedFn);
  assert.ok(latestFn);
  assert.ok(poolFn);
  assert.match(recommendedFn, /WHERE \$\{COUNTABLE_PUBLIC_VIDEO_SQL\}/);
  assert.match(latestFn, /WHERE \$\{COUNTABLE_PUBLIC_VIDEO_SQL\}/);
  assert.match(poolFn, /WHERE \$\{COUNTABLE_PUBLIC_VIDEO_SQL\}/);
  assert.doesNotMatch(recommendedFn, /WHERE v\.visibility_status = 'public'/);
  assert.doesNotMatch(latestFn, /WHERE v\.visibility_status = 'public'/);
  assert.doesNotMatch(poolFn, /WHERE v\.visibility_status = 'public'/);
});

test("rebuildTopNostalgicは新着100件と3年以上前のYouTube確認済みプールから日次シャッフル用に保存する", () => {
  const nostalgicFn = source.match(
    /async function rebuildTopNostalgic\(env[\s\S]*?(?=async function )/,
  )?.[0];
  assert.ok(nostalgicFn);
  assert.match(source, /TOP_LATEST_LIMIT = 100/);
  assert.match(source, /TOP_NOSTALGIA_LIMIT = 20/);
  assert.match(source, /TOP_NOSTALGIA_POOL = 200/);
  assert.match(nostalgicFn, /loadTopNostalgicPool/);
  assert.match(nostalgicFn, /resolveNostalgicDisplaySelection/);
  assert.match(nostalgicFn, /pool: nostalgicPool/);
  assert.match(nostalgicFn, /display: selection\.display/);
  assert.match(nostalgicFn, /shuffled_at: selection\.shuffledAt/);
  assert.match(nostalgicFn, /selection_day: selection\.selectionDay/);
  assert.match(nostalgicFn, /if \(selection\.isNewDaySelection\)/);
});

test("top_nostalgic 同日再生成は RANDOM を再実行せず private 化動画を表示から外す", async () => {
  const now = Math.floor(Date.now() / 1000);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(
    new Date(now * 1000),
  );
  const queries = [];
  const puts = [];
  const previous = {
    schema_version: 1,
    generated_at: now - 10,
    pool: [
      { id: "n1", title: "N1", display_name: "Creator", youtube_video_id: "yt-1" },
      { id: "n2", title: "N2", display_name: "Creator", youtube_video_id: "yt-2" },
    ],
    display: [
      { id: "n1", title: "N1", display_name: "Creator", youtube_video_id: "yt-1" },
      { id: "n2", title: "N2", display_name: "Creator", youtube_video_id: "yt-2" },
    ],
    shuffled_at: now - 100,
    selection_day: today,
  };
  const env = {
    DB: {
      prepare(sql) {
        const statement = {
          sql,
          bind(...args) {
            queries.push({ sql, args });
            return statement;
          },
          async all() {
            if (sql.includes("json_each")) {
              return { results: [{ id: "n1", title: "N1 refreshed", display_name: "Creator", youtube_video_id: "yt-1" }] };
            }
            return { results: [] };
          },
          async first() { return null; },
          async run() { return { meta: { changes: 0 } }; },
        };
        return statement;
      },
      async batch() { return []; },
    },
    R2: {
      async get(key) {
        if (key === "top/sections/nostalgic.v1.json") return { async json() { return previous; } };
        return null;
      },
      async head() { return null; },
      async put(key, body) { puts.push({ key, body: JSON.parse(String(body)) }); },
      async delete() {},
    },
    KV: { async put() {} },
  };

  await rebuildTarget(env, "top_nostalgic", "global");

  assert.equal(queries.filter((row) => row.sql.includes("ORDER BY RANDOM()")).length, 0);
  const artifact = puts.find((entry) => entry.key === "top/sections/nostalgic.v1.json");
  assert.ok(artifact);
  assert.deepEqual(artifact.body.display.map((item) => item.id), ["n1"]);
  assert.equal(artifact.body.display[0].title, "N1 refreshed");
});

test("top_nostalgic は JST 日付変更または壊れた artifact のときだけ RANDOM pool を再生成する", async () => {
  const now = Math.floor(Date.now() / 1000);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(
    new Date(now * 1000),
  );
  const yesterday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(
    new Date((now - 86_400) * 1000),
  );
  const cases = [
    {
      name: "日付変更",
      previous: {
        schema_version: 1,
        generated_at: now - 100,
        pool: [{ id: "old", title: "Old", display_name: "Creator" }],
        display: [{ id: "old", title: "Old", display_name: "Creator" }],
        shuffled_at: now - 86_400,
        selection_day: yesterday,
      },
    },
    {
      name: "壊れたpool",
      previous: {
        schema_version: 1,
        generated_at: now - 100,
        pool: [{ id: "broken" }],
        display: [],
        shuffled_at: now,
        selection_day: today,
      },
    },
    {
      name: "pool上限超過",
      previous: {
        schema_version: 1,
        generated_at: now - 100,
        pool: Array.from({ length: 201 }, (_, index) => ({
          id: `too-many-${index}`,
          title: "Too many",
          display_name: "Creator",
        })),
        display: [],
        shuffled_at: now,
        selection_day: today,
      },
    },
    {
      name: "pool重複ID",
      previous: {
        schema_version: 1,
        generated_at: now - 100,
        pool: [
          { id: "duplicate", title: "Duplicate", display_name: "Creator" },
          { id: "duplicate", title: "Duplicate", display_name: "Creator" },
        ],
        display: [{ id: "duplicate", title: "Duplicate", display_name: "Creator" }],
        shuffled_at: now,
        selection_day: today,
      },
    },
    {
      name: "pool非空でdisplay空",
      previous: {
        schema_version: 1,
        generated_at: now - 100,
        pool: [{ id: "pool-item", title: "Pool item", display_name: "Creator" }],
        display: [],
        shuffled_at: now,
        selection_day: today,
      },
    },
  ];

  for (const { name, previous } of cases) {
    const queries = [];
    const puts = [];
    const env = {
      DB: {
        prepare(sql) {
          const statement = {
            sql,
            bind(...args) {
              queries.push({ sql, args });
              return statement;
            },
            async all() {
              if (sql.includes("ORDER BY RANDOM()")) {
                return {
                  results: [{
                    id: "fresh",
                    title: "Fresh",
                    display_name: "Creator",
                    youtube_video_id: "yt-fresh",
                  }],
                };
              }
              return { results: [] };
            },
            async first() { return null; },
            async run() { return { meta: { changes: 1 } }; },
          };
          return statement;
        },
        async batch() { return []; },
      },
      R2: {
        async get(key) {
          if (key === "top/sections/nostalgic.v1.json") {
            return { async json() { return previous; } };
          }
          return null;
        },
        async head() { return null; },
        async put(key, body) {
          puts.push({ key, body: JSON.parse(String(body)) });
        },
      },
      KV: { async put() {} },
    };

    await rebuildTarget(env, "top_nostalgic", "global");

    assert.equal(
      queries.filter((row) => row.sql.includes("ORDER BY RANDOM()")).length,
      1,
      name,
    );
    const artifact = puts.find((entry) => entry.key === "top/sections/nostalgic.v1.json");
    assert.ok(artifact);
    assert.deepEqual(artifact.body.display.map((item) => item.id), ["fresh"]);
  }
});

test("ensureDailyTopNostalgicShuffleはJST日次でtop_nostalgic再生成をキュー登録する", () => {
  const fn = source.match(
    /export async function ensureDailyTopNostalgicShuffle[\s\S]*?(?=\/\*\*|export async function |async function )/,
  )?.[0];
  assert.ok(fn);
  assert.match(fn, /TOP_NOSTALGIC_SHUFFLE_DAY_KV_KEY/);
  assert.match(fn, /enqueueTopSectionRebuild/);
  assert.match(fn, /"top_nostalgic"/);
  assert.match(fn, /nostalgic_daily_shuffle/);
  assert.doesNotMatch(fn, /env\.KV\.put/);
  assert.doesNotMatch(fn, /JSON\.parse/);
  assert.doesNotMatch(fn, /env\.R2\.get\("top\.json"\)/);
});

test("日次シャッフルのenqueue成功だけでは完了マーカーを保存しない", async () => {
  const kvPuts = [];
  const batches = [];
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return { sql, args };
          },
        };
      },
      async batch(statements) {
        batches.push(statements);
        return [{ meta: { changes: 0 } }, { meta: { changes: 1 } }];
      },
    },
    KV: {
      async get() {
        return null;
      },
      async put(...args) {
        kvPuts.push(args);
      },
    },
  };

  assert.equal(await ensureDailyTopNostalgicShuffle(env), 1);
  assert.equal(batches.length, 1);
  assert.deepEqual(kvPuts, []);
});

test("rebuildTop composerはslot-stats artifactをtop.jsonへ合成する", async () => {
  const now = Math.floor(Date.now() / 1000);
  const sectionPayload = (items) => ({
    schema_version: 1,
    generated_at: now,
    items,
  });
  const puts = [];
  const env = {
    DB: { prepare: (sql) => statement(sql, { binds: [], runs: [], first: () => null, all: () => ({ results: [] }) }) },
    R2: {
      async get(key) {
        const sections = {
          "top/sections/recommended.v1.json": sectionPayload([{ id: "r1", title: "R1", display_name: "A" }]),
          "top/sections/latest.v1.json": sectionPayload([{ id: "l1", title: "L1", display_name: "A" }]),
          "top/sections/nostalgic.v1.json": {
            schema_version: 1,
            generated_at: now,
            pool: [{ id: "n1", title: "N1", display_name: "A" }],
            display: [{ id: "n1", title: "N1", display_name: "A" }],
            shuffled_at: now,
            selection_day: "2026-08-08",
          },
          "top/sections/events.v1.json": {
            schema_version: 1,
            generated_at: now,
            active_events: [],
            latest_events: [],
          },
          "top/sections/announcements.v1.json": sectionPayload([]),
          "top/sections/stats.v1.json": {
            schema_version: 1,
            generated_at: now,
            stats: {
              public_videos: 3,
              active_events: 0,
              public_events: 7,
              creators: 2,
            },
          },
          "top/slot-stats.v1.json": {
            schema_version: 1,
            generated_at: now,
            items: [{ event_id: "hero-1", available: 1, total: 2 }],
          },
          [PICKUP_CREATORS_OBJECT_KEY]: {
            schema_version: 1,
            generated_at: now,
            creators: [{ id: "u1", x_name: "User", icon_url: null, video_count: 1, collab_count: 0 }],
          },
        };
        const payload = sections[key];
        if (!payload) return null;
        return { async json() { return payload; } };
      },
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
  assert.equal(top.body.slot_stats.length, 1);
  assert.equal(top.body.recommended[0].id, "r1");
  assert.equal(top.body.nostalgic_pool[0].id, "n1");
});

test("rebuildTopSlotStatsはヒーローイベントのslot_statsだけをartifactへ書く", async () => {
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
            available: 4,
            total: 6,
          })),
        };
      }
      if (
        sql.includes("FROM events") &&
        sql.includes("visibility_status = 'public'") &&
        sql.includes("ORDER BY start_time DESC") &&
        sql.includes("LIMIT 30")
      ) {
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

  await rebuildTarget(env, "top_slot_stats", "global");

  assert.equal(slotQueries.length, 1);
  assert.deepEqual(slotQueries[0].args, heroIds);
  const artifact = puts.find((entry) => entry.key === "top/slot-stats.v1.json");
  assert.ok(artifact);
  assert.equal(artifact.body.schema_version, 1);
  assert.equal(artifact.body.items.length, 2);
  assert.ok(artifact.body.items.every((row) => heroIds.includes(row.event_id)));
  assert.ok(artifact.body.items.every((row) => row.event_id !== "other-event"));
  assert.equal(puts.some((entry) => entry.key === "top.json"), false);
});

test("rebuildTopStatsはpublicEventCount由来のstats.public_eventsを返す", async () => {
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

  await rebuildTarget(env, "top_stats", "global");

  const stats = puts.find((entry) => entry.key === "top/sections/stats.v1.json");
  assert.ok(stats);
  assert.equal(stats.body.stats.public_events, 7);
});

test("rebuildUsersIndex成功後にtop/recommend follow-upをenqueueする", () => {
  assert.match(
    source,
    /case "event_base":[\s\S]*if \(shouldCompose\)[\s\S]*enqueuePerTargetComposerFollowUp/,
  );
  assert.match(
    source,
    /case "event_slots":[\s\S]*if \(shouldCompose\)[\s\S]*enqueuePerTargetComposerFollowUp/,
  );
  assert.match(source, /case "users_index":[\s\S]*enqueueComposerFollowUps/);
});

test("rebuildEventBase/rebuildEventSlotsは非公開時にcompose不要を返す", () => {
  const eventBaseFn = source.match(
    /async function rebuildEventBase\([\s\S]*?(?=async function rebuildEventSlots)/,
  )?.[0];
  const eventSlotsFn = source.match(
    /async function rebuildEventSlots\([\s\S]*?(?=async function rebuildEvent\()/,
  )?.[0];
  assert.ok(eventBaseFn);
  assert.ok(eventSlotsFn);
  assert.match(eventBaseFn, /Promise<boolean>/);
  assert.match(eventSlotsFn, /Promise<boolean>/);
  assert.match(eventBaseFn, /removeAllEventArtifacts[\s\S]*return false/);
  assert.match(eventSlotsFn, /removeAllEventArtifacts[\s\S]*return false/);
  assert.match(eventBaseFn, /return true;/);
  assert.match(eventSlotsFn, /return true;/);
});

test("rename old-event cleanup removes canonical artifacts while retaining its tombstone during worker processing", () => {
  const eventFn = source.match(
    /async function rebuildEvent\([\s\S]*?(?=type StaticRelatedVideoRow)/,
  )?.[0];
  assert.ok(eventFn);
  assert.match(source, /case "event":[\s\S]*rebuildEvent\(env, targetId, signal, reason\)/);
  assert.match(eventFn, /removeAllEventArtifacts\(env, eventId, signal\)/);
  assert.match(eventFn, /old event ID remains blocked while cleanup is running/);
  assert.doesNotMatch(source, /clearEventRenameTombstone/);
  assert.doesNotMatch(source, /DELETE FROM public_visibility_fences/);
  assert.match(source, /`events\/\$\{eventId\}\.json`/);
});

test("rebuildRecommendCore成功後にrecommend composer follow-upをenqueueする", () => {
  assert.match(source, /case "recommend_core":[\s\S]*enqueueComposerFollowUps\(env, "recommend_core"\)/);
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

test("rebuildUserはown/collabをCOUNT(*) OVER()で1 queryずつ取得する", () => {
  const userFn = source.match(
    /async function rebuildUser\([\s\S]*?(?=\nasync function |\nfunction |$)/,
  )?.[0];

  assert.ok(userFn);
  assert.match(userFn, /COUNT\(\*\) OVER\(\) AS total_count/g);
  assert.doesNotMatch(
    userFn,
    /SELECT COUNT\(\*\) AS c[\s\S]*FROM videos AS v[\s\S]*creator_x_user_id = \?/,
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

test("再公開 artifact 完成後だけ release_pending fence を token CAS で解除する", () => {
  assert.match(source, /releaseVisibilityFenceAfterRebuild/);
  assert.match(source, /state = 'release_pending'/);
  assert.match(source, /entry\.fence_token !== fenceToken/);
  assert.match(source, /result\.meta\?\.changes/);
  assert.match(source, /state = 'released'/);
  assert.match(source, /writeWorkerVisibilityBlockedEntitiesManifest/);
});

test("event cleanup explicitly removes the playlist artifact and tracking rows", () => {
  const cleanupFn = source.match(
    /async function removeAllEventArtifacts\([\s\S]*?(?=\nfunction eventBaseObjectKey)/,
  )?.[0];
  assert.ok(cleanupFn);
  assert.match(cleanupFn, /removeTrackedArtifacts\(env, "event_playlist"/);
  assert.match(cleanupFn, /eventPlaylistObjectKey\(eventId\)/);
});

test("event release is required before an event promotion fence is released", () => {
  const releaseFn = source.match(
    /async function releaseVisibilityFenceAfterRebuild\([\s\S]*?(?=\nasync function )/,
  )?.[0];
  assert.ok(releaseFn);
  assert.match(releaseFn, /target_type IN \('event_base', 'event_slots', 'event_release', 'event_playlist'\)/);
  assert.match(releaseFn, /sourceByTarget\.get\("event_release"\)/);
  assert.match(releaseFn, /sourceByTarget\.get\("event_playlist"\)/);
  const eventReleaseFn = source.match(
    /async function rebuildEventRelease\([\s\S]*?(?=\nfunction stripEventPublicVideoScore)/,
  )?.[0];
  assert.ok(eventReleaseFn);
  assert.match(eventReleaseFn, /releaseVisibilityFenceAfterRebuild\([\s\S]*?"event"/);
});

test("event release member query bounds public member rows per video", () => {
  const eventReleaseFn = source.match(
    /async function rebuildEventRelease\([\s\S]*?(?=\nfunction stripEventPublicVideoScore)/,
  )?.[0];
  assert.ok(eventReleaseFn);
  assert.match(eventReleaseFn, /ROW_NUMBER\(\) OVER/);
  assert.match(eventReleaseFn, /member_rank <= \$\{EVENT_RELEASE_MAX_MEMBERS_PER_VIDEO\}/);
  assert.match(eventReleaseFn, /vm\.is_public_member = 1/);
});

test("legacy X ID casing does not strand a release fence", () => {
  const releaseFn = source.match(
    /async function releaseVisibilityFenceAfterRebuild\([\s\S]*?(?=\nasync function )/,
  )?.[0];
  assert.ok(releaseFn);
  assert.match(
    releaseFn,
    /const fenceEntityId =\s*\n\s*entityType === "x_user" \? entityId\.trim\(\)\.toLowerCase\(\) : entityId/,
  );
  assert.match(releaseFn, /LOWER\(id\) = LOWER\(\?\)/);
  assert.match(releaseFn, /LOWER\(target_id\) = LOWER\(\?\)/);
  assert.match(releaseFn, /entityType,\s*fenceEntityId,\s*fenceToken/);
});

test("video artifact success checks pending fence independent of queue reason", () => {
  const videoFn = source.match(
    /async function rebuildVideo\([\s\S]*?(?=\nasync function rebuildUsersIndex)/,
  )?.[0];
  assert.ok(videoFn);
  assert.match(videoFn, /releaseVisibilityFenceAfterRebuild\(env, "video"/);
  assert.doesNotMatch(videoFn, /if \(reason === "video_visibility_update"\)/);
});

test("static related near-date lookup avoids an ABS full scan", () => {
  const relatedFn = source.match(
    /async function fetchStaticRelatedVideos[\s\S]*?(?=\nasync function )/,
  )?.[0];

  assert.ok(relatedFn);
  assert.doesNotMatch(relatedFn, /ORDER BY ABS\(v\.scheduled_time/);
  assert.match(relatedFn, /v\.scheduled_time <= \?/);
  assert.match(relatedFn, /v\.scheduled_time > \?/);
  assert.match(relatedFn, /nearDateCandidateLimit/);
});
