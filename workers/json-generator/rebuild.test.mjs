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
  rebuildTarget,
  removeTrackedArtifacts,
} from "./rebuild.ts";
import { PUBLIC_LISTABLE_X_APPROVAL_SQL_IN } from "../../src/lib/utils/publicXUser.ts";

const source = await readFile(new URL("./rebuild.ts", import.meta.url), "utf8");

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
    source,
    /WHERE xu\.approval_status IN \(\$\{PUBLIC_LISTABLE_X_APPROVAL_SQL_IN\}\)/,
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
  assert.match(source, /staticArtifactContentHash\(body\)/);
});

test("public static JSON queries exclude private event relations", () => {
  assert.match(
    source,
    /FROM slots AS s[\s\S]*INNER JOIN events AS e[\s\S]*e\.visibility_status = 'public'/,
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
  assert.equal(POPULAR_LIST_LIMIT, 60);
  assert.match(source, /STATIC_LIST_VIDEO_SELECT[\s\S]*creator_x_user_id/);
  assert.match(source, /STATIC_LIST_VIDEO_SELECT[\s\S]*primary_event_title/);
  assert.match(source, /STATIC_LIST_VIDEO_SELECT[\s\S]*visibility_status AS status/);
  assert.match(popularFn, /WHERE \$\{COUNTABLE_PUBLIC_VIDEO_SQL\}/);
  assert.match(
    popularFn,
    /SELECT COUNT\(\*\) AS c FROM videos AS v WHERE \$\{COUNTABLE_PUBLIC_VIDEO_SQL\}/,
  );
  assert.match(popularFn, /total: Number\(totalRow/);
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
