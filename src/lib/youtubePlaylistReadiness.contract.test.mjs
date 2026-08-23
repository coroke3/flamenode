import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readFromRoot = (path) =>
  readFile(new URL(`../../${path}`, import.meta.url), "utf8");

const REQUIRED_YOUTUBE_SECRETS = [
  "YOUTUBE_API_KEY",
  "YOUTUBE_OAUTH_CLIENT_ID",
  "YOUTUBE_OAUTH_CLIENT_SECRET",
  "YOUTUBE_OAUTH_REFRESH_TOKEN",
];

const REQUIRED_PLAYLIST_TABLES = [
  "event_youtube_playlist_sync",
  "event_youtube_playlist_items",
  "external_api_quota_usage",
];

test("YouTube再生リスト同期は現行sync-jobsの52分枠と必要bindingを持つ", async () => {
  const [wrangler, worker] = await Promise.all([
    readFromRoot("workers/sync-jobs/wrangler.toml"),
    readFromRoot("workers/sync-jobs/index.ts"),
  ]);

  assert.match(wrangler, /crons\s*=\s*\["7 \* \* \* \*", "52 \* \* \* \*"\]/);
  assert.match(wrangler, /binding\s*=\s*"DB"/);
  assert.match(wrangler, /binding\s*=\s*"KV"/);
  assert.match(wrangler, /binding\s*=\s*"YOUTUBE_SYNC_WAKE_QUEUE"/);
  assert.match(wrangler, /binding\s*=\s*"STATIC_REBUILD_WAKE_QUEUE"/);
  assert.match(worker, /return now\.getUTCMinutes\(\) === 52/);
  assert.match(worker, /syncEventPlaylists\(env, signal\)/);
});

test("production deploy契約はplaylist同期に必要なsecret名をfail-closed検査する", async () => {
  const production = await readFromRoot("scripts/cloudflare-production.mjs");
  const syncRequirements = production.match(
    /"sync-jobs":\s*\[([\s\S]*?)\n\s*\],/,
  );
  assert.ok(syncRequirements, "sync-jobs の remote secret 要件が必要です");
  for (const name of REQUIRED_YOUTUBE_SECRETS) {
    assert.match(syncRequirements[1], new RegExp(`"${name}"`), name);
  }
});

test("production schema契約はplaylist同期テーブルとYouTube quota正本を要求する", async () => {
  const schemaContract = await readFromRoot("src/lib/health/schemaContract.ts");
  for (const table of REQUIRED_PLAYLIST_TABLES) {
    assert.match(schemaContract, new RegExp(`"${table}"`), table);
  }
});

test("管理画面の実行予約はHTTP内でYouTube APIを直接呼ばずD1 due状態だけを更新する", async () => {
  const action = await readFromRoot("src/lib/actions/event-youtube-playlist.ts");
  assert.match(action, /export async function queueEventYoutubePlaylistSync/);
  assert.match(action, /next_sync_at:\s*now/);
  assert.match(action, /sync_status:\s*"idle"/);
  assert.doesNotMatch(action, /googleapis\.com\/youtube|syncEventPlaylists\(/);
});

test("playlist同期WorkerはOAuth欠損時に外部APIを開始しない", async () => {
  const worker = await readFromRoot("workers/youtube-playlist-sync/index.ts");
  for (const name of [
    "YOUTUBE_OAUTH_CLIENT_ID",
    "YOUTUBE_OAUTH_CLIENT_SECRET",
    "YOUTUBE_OAUTH_REFRESH_TOKEN",
  ]) {
    assert.match(worker, new RegExp(name));
  }
  assert.match(worker, /if \(!hasOAuth\) return result\(\{ processed: 0, skipped: 1, failed: 0 \}\)/);
});
