import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

async function source(path) {
  return readFile(new URL(`../../../${path}`, import.meta.url), "utf8");
}

test("queue集計は dead_letter と oldestPendingAt を含む", async () => {
  const text = await source("src/lib/admin/workerMonitoring.ts");

  assert.match(
    text,
    /SUM\(CASE WHEN status = 'dead_letter' THEN 1 ELSE 0 END\) AS dead_letter/,
  );
  assert.match(text, /MIN\(CASE WHEN status = 'pending' THEN created_at END\) AS oldest_pending_at/);
  assert.match(text, /oldestPendingAt: nullableNumber\(row\?\.oldest_pending_at\)/);
  assert.match(text, /WHERE status IN \('pending', 'processing', 'failed', 'dead_letter'\)/);
});

test("YouTube監視は sync_status=pending 件数を返す", async () => {
  const text = await source("src/lib/admin/workerMonitoring.ts");

  assert.match(
    text,
    /SELECT COUNT\(\*\) FROM video_youtube_metadata WHERE sync_status = 'pending'\) AS pending/,
  );
  assert.match(text, /pending: numberValue\(youtubeRow\?\.pending\)/);
  assert.doesNotMatch(text, /ym\.youtube_video_id/);
});

test("YouTube stale candidates are metadata-first and use event existence checks", async () => {
  const text = await source("src/lib/admin/workerMonitoring.ts");

  assert.match(
    text,
    /FROM video_youtube_metadata ym[\s\S]*INNER JOIN videos v ON v\.id = ym\.video_id[\s\S]*ym\.sync_status IN \('synced', 'failed'\)/,
  );
  assert.match(text, /EXISTS \([\s\S]*FROM events e[\s\S]*e\.id = v\.primary_event_id/);
  assert.match(text, /EXISTS \([\s\S]*FROM video_events ve[\s\S]*INNER JOIN events e ON e\.id = ve\.event_id/);
  assert.doesNotMatch(
    text,
    /FROM events e[\s\S]*INNER JOIN videos v ON \([\s\S]*v\.primary_event_id = e\.id/,
  );
});

test("YouTube stale aggregate does not rescan the same metadata row across lanes", async () => {
  const text = await source("src/lib/admin/workerMonitoring.ts");

  assert.doesNotMatch(text, /WITH stale_candidates AS/);
  assert.match(text, /FROM video_youtube_metadata ym[\s\S]*ym\.synced_at <= \?1 - 86400/);
  assert.match(text, /ym\.synced_at > \?1 - 86400[\s\S]*ym\.synced_at <= \?1 - 3600/);
});

test("スコア stale 閾値は score-recalc の 72h と揃える", async () => {
  const text = await source("src/lib/admin/workerMonitoring.ts");

  assert.match(text, /SCORE_STALE_THRESHOLD_SEC = 72 \* 60 \* 60/);
  assert.match(text, /score_updated_at <= \?1 - \?2/);
  assert.doesNotMatch(text, /score_updated_at <= \?1 - 86400/);
});

test("Queue wake 最終失敗は KV キーごとに上書き読取する", async () => {
  const text = await source("src/lib/admin/workerMonitoring.ts");

  assert.match(text, /`queue_wake:last_failure:\$\{kind\}`/);
  assert.match(text, /QUEUE_WAKE_LAST_FAILURE_KV_KEYS/);
  assert.match(text, /loadQueueWakeFailures/);
  assert.match(text, /queueWakeFailures: QueueWakeFailures \| null/);
  assert.match(text, /if \(!kv\) return null/);
});

test("workers監視ページはキュー指標と wake 失敗警告を表示する", async () => {
  const page = await source("app/(admin)/admin/workers/page.tsx");

  assert.match(page, /キュー状態/);
  assert.match(page, /dead_letter/);
  assert.match(page, /Queue wake 最終失敗/);
  assert.match(page, /kv: env\.KV/);
});
