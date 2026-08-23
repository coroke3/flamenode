import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");

// Workers Builds の軽量検査で、metadata(max 8 external requests) と
// playlist(max 12)を同一Queue invocationへ戻してしまう回帰を止める。
test("mixed YouTube queue batchは重いmetadataとplaylistを同一invocationで実行しない", () => {
  assert.match(source, /const mixedYoutubeKinds =/);
  assert.match(
    source,
    /if \(metadataMessages\.length > 0 && !mixedYoutubeKinds\)/,
  );
  assert.match(source, /if \(playlistMessages\.length > 0\)/);
  assert.match(
    source,
    /if \(mixedYoutubeKinds\)[\s\S]*ackAll\(metadataMessages\)[\s\S]*maybeResendYoutubePendingWake\([\s\S]*"continuation"/,
  );
});

test("playlist backlogはD1 due正本からbounded continuationへ変換する", () => {
  assert.match(source, /async function maybeContinueYoutubePlaylistSync/);
  assert.match(
    source,
    /FROM event_youtube_playlist_sync[\s\S]*enabled = 1[\s\S]*COALESCE\(next_sync_at, 0\) <= \?1[\s\S]*LIMIT 1/,
  );
  assert.match(
    source,
    /kind:\s*"youtube_playlist_sync"[\s\S]*source:\s*"continuation"/,
  );
  assert.match(source, /!flags\.continuationEnabled/);
  assert.match(source, /playlistJob\.quota_stopped/);
  assert.match(source, /playlistCounters\.quota_stopped/);
});

test("playlist quota停止はQueue retryやCron失敗へ変換しない", () => {
  assert.match(source, /export function normalizePlaylistQuotaStop/);
  assert.match(source, /!result\.quota_stopped \|\| result\.failed <= 0/);
  assert.match(source, /skipped:\s*result\.skipped \+ result\.failed/);
  assert.match(source, /failed:\s*0/);
  assert.ok(
    (source.match(/normalizePlaylistQuotaStop\(/g) ?? []).length >= 3,
    "normalizer definition + Queue + Cron calls are required",
  );
});

test("continuation判定失敗は成功済みjobを壊さずRecovery Cronへ委ねる", () => {
  assert.match(source, /youtube-playlist-continuation-check/);
  assert.match(source, /youtube-pending-recovery-check/);
  assert.match(source, /result:\s*"deferred_to_recovery"/);
  assert.match(source, /return false/);
});
