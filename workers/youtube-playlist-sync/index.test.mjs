import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PLAYLIST_MAX_REMOTE_ITEMS,
  PLAYLIST_STALE_DELETE_BATCH_SIZE,
  calculateSyncDiff,
  cleanupStaleScanItems,
  syncEventPlaylists,
} from "./index.ts";

const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
const remote = [
  { playlist_item_id: "item-a", youtube_video_id: "video-a" },
  { playlist_item_id: "item-old", youtube_video_id: "video-old" },
];

test("worker module loads in Node strip-only mode", () => {
  assert.equal(typeof calculateSyncDiff, "function");
});

test("append_only adds missing videos without deleting remote items", () => {
  const diff = calculateSyncDiff(["video-a", "video-b"], remote, "append_only");
  assert.deepEqual(diff.additions, ["video-b"]);
  assert.deepEqual(diff.removals, []);
});

test("missing videos preserve source schedule order", () => {
  const diff = calculateSyncDiff(
    ["video-first", "video-a", "video-middle", "video-last"],
    remote,
    "append_only",
  );
  assert.deepEqual(diff.additions, [
    "video-first",
    "video-middle",
    "video-last",
  ]);
});

test("mirror adds missing videos and removes videos outside the event", () => {
  const diff = calculateSyncDiff(["video-a", "video-b"], remote, "mirror");
  assert.deepEqual(diff.additions, ["video-b"]);
  assert.deepEqual(diff.removals, [remote[1]]);
});

test("playlist外部呼出しは共通timeoutと固定予算を使う", () => {
  assert.match(source, /from "\.\.\/shared\/externalApi\.ts"/);
  assert.match(source, /MAX_EXTERNAL_REQUESTS_PER_RUN = 12/);
  assert.match(source, /new ExternalRequestBudget\(MAX_EXTERNAL_REQUESTS_PER_RUN\)/);
  assert.doesNotMatch(source, /async function fetchWithTimeout/);
});

test("OAuth tokenをisolate内で期限付き再利用し401で破棄する", () => {
  assert.match(source, /__flamenodeYoutubePlaylistAccessToken/);
  assert.match(source, /OAUTH_TOKEN_SAFETY_MS/);
  assert.match(source, /response\.status === 401/);
  assert.match(source, /clearCachedAccessToken\(\)/);
});

test("playlist APIはpartial responseとcompact JSONを使う", () => {
  assert.match(source, /nextPageToken,items\(id,snippet\/resourceId\/videoId\)/);
  assert.match(source, /url\.searchParams\.set\("fields", "id"\)/);
  assert.ok((source.match(/prettyPrint/g) ?? []).length >= 3);
});

test("source重複排除とD1保存はDB側でまとめる", () => {
  assert.match(source, /GROUP BY v\.youtube_video_id/);
  assert.doesNotMatch(source, /new Set\(rows\.map/);
  assert.match(source, /env\.DB\.batch\(statements\)/);
  assert.match(source, /DELETE FROM event_youtube_playlist_items[\s\S]*LIMIT \?3/);
});

test("無効な制御処理と線形indexOfを残さない", () => {
  assert.doesNotMatch(source, /async persist\(\)/);
  assert.doesNotMatch(source, /quota\.persist\(\)/);
  assert.doesNotMatch(source, /sourceVideoIds\.indexOf/);
  assert.match(source, /const sourcePositions = new Map/);
});

test("remote itemsとstale削除を固定上限で処理する", () => {
  assert.equal(PLAYLIST_MAX_REMOTE_ITEMS, 5000);
  assert.equal(PLAYLIST_STALE_DELETE_BATCH_SIZE, 100);
  assert.match(
    source,
    /FROM event_youtube_playlist_items[\s\S]*ORDER BY created_at, playlist_item_id[\s\S]*LIMIT \?2/,
  );
  assert.match(source, /PLAYLIST_MAX_REMOTE_ITEMS \+ 1/);
  assert.match(source, /youtube_playlist_remote_limit_exceeded/);
  assert.match(source, /scan_page_token = \?2[\s\S]*STALE_CLEANUP_CURSOR/);
  assert.doesNotMatch(
    source,
    /DELETE FROM event_youtube_playlist_items\s+WHERE event_id = \?1 AND seen_at <> \?2/,
  );
});

function staleCleanupEnv(deleteChanges, onDelete = () => {}) {
  const calls = [];
  return {
    calls,
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            calls.push({ sql, args });
            return this;
          },
          async run() {
            if (sql.includes("DELETE FROM event_youtube_playlist_items")) {
              onDelete();
            }
            return {
              meta: {
                changes: sql.includes("DELETE FROM event_youtube_playlist_items")
                  ? deleteChanges
                  : 1,
              },
            };
          },
        };
      },
    },
  };
}

test("stale削除が上限到達時はcleanup cursorで再開待ちにする", async () => {
  const env = staleCleanupEnv(PLAYLIST_STALE_DELETE_BATCH_SIZE);
  const completed = await cleanupStaleScanItems(
    env,
    { event_id: "event-1" },
    123,
    456,
  );
  assert.equal(completed, false);
  const deleteCall = env.calls.find(({ sql }) =>
    sql.includes("DELETE FROM event_youtube_playlist_items"),
  );
  assert.deepEqual(deleteCall.args, ["event-1", 123, PLAYLIST_STALE_DELETE_BATCH_SIZE]);
  assert.ok(env.calls.some(({ args }) => args.includes("__flamenode_stale_cleanup__")));
});

test("stale削除が上限未満ならscanを完了する", async () => {
  const env = staleCleanupEnv(3);
  const completed = await cleanupStaleScanItems(
    env,
    { event_id: "event-1" },
    123,
    456,
  );
  assert.equal(completed, true);
  assert.ok(env.calls.some(({ sql }) => sql.includes("SET sync_status = 'idle'")));
});

test("stale削除のchangesが得られない場合は完了扱いにしない", async () => {
  const env = staleCleanupEnv(undefined);
  await assert.rejects(
    () => cleanupStaleScanItems(env, { event_id: "event-1" }, 123, 456),
    /youtube_playlist_stale_cleanup_changes_unavailable/,
  );
  assert.equal(
    env.calls.some(({ sql }) => sql.includes("SET sync_status = 'idle'")),
    false,
  );
});

test("stale削除中のdeadline中断後は状態更新を続けない", async () => {
  const controller = new AbortController();
  const deadline = new DOMException("deadline", "AbortError");
  const env = staleCleanupEnv(3, () => controller.abort(deadline));
  await assert.rejects(
    () => cleanupStaleScanItems(
      env,
      { event_id: "event-1" },
      123,
      456,
      controller.signal,
    ),
    (error) => error === deadline,
  );
  assert.equal(
    env.calls.some(({ sql }) => sql.includes("SET sync_status = 'idle'")),
    false,
  );
});

function playlistAbortEnv() {
  const writes = [];
  return {
    writes,
    YOUTUBE_OAUTH_CLIENT_ID: "client-id",
    YOUTUBE_OAUTH_CLIENT_SECRET: "client-secret",
    YOUTUBE_OAUTH_REFRESH_TOKEN: "refresh-token",
    DB: {
      prepare(sql) {
        return {
          bind() {
            return {
              async all() {
                return {
                  results: [{
                    event_id: "event-1",
                    playlist_id: "playlist-1",
                    sync_mode: "append_only",
                    sync_interval_minutes: 60,
                    sync_status: "idle",
                    next_sync_at: 0,
                    last_synced_at: null,
                    last_full_scan_at: null,
                    scan_started_at: null,
                    scan_page_token: null,
                  }],
                };
              },
              async first() {
                return null;
              },
              async run() {
                writes.push(sql);
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      },
    },
  };
}

test("OAuth fetch中のdeadline中断を失敗記録として飲み込まない", async () => {
  const env = playlistAbortEnv();
  const controller = new AbortController();
  const deadline = new DOMException("deadline", "AbortError");
  let fetchCalls = 0;
  const abortingFetch = (_input, init = {}) => {
    fetchCalls += 1;
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener(
        "abort",
        () => reject(init.signal.reason ?? new DOMException("aborted", "AbortError")),
        { once: true },
      );
      controller.abort(deadline);
    });
  };

  await assert.rejects(
    () => syncEventPlaylists(env, controller.signal, abortingFetch),
    (error) => error === deadline,
  );
  assert.equal(fetchCalls, 1);
  assert.deepEqual(env.writes, []);
});
