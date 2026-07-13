import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

async function source(path) {
  return readFile(new URL(`../../../${path}`, import.meta.url), "utf8");
}

test("管理画面からWorker監視ページへ移動できる", async () => {
  const nav = await source("src/lib/admin/adminNavGroups.tsx");
  const tabs = await source("src/components/admin/AdminSectionTabs.tsx");
  const page = await source("app/(admin)/admin/workers/page.tsx");

  assert.match(nav, /href:\s*"\/admin\/workers"/);
  assert.match(tabs, /href:\s*"\/admin\/workers"/);
  assert.match(page, /loadWorkerMonitoring/);
  assert.match(page, /Cloudflare Dashboard/);
  assert.match(page, /YouTube API Quotas/);
});

test("監視集約は主要Workerとqueueを読み取り専用で確認する", async () => {
  const text = await source("src/lib/admin/workerMonitoring.ts");

  assert.match(text, /jobName:\s*"fast-jobs"/);
  assert.match(text, /jobName:\s*"content-jobs"/);
  assert.match(text, /jobName:\s*"sync-jobs"/);
  assert.match(text, /FROM worker_leases/);
  assert.match(text, /FROM notification_outbox/);
  assert.match(text, /FROM static_rebuild_queue/);
  assert.match(text, /FROM static_artifacts/);
  assert.doesNotMatch(
    text,
    /\b(?:UPDATE|INSERT|DELETE)\s+(?:worker_leases|notification_outbox|static_rebuild_queue)/i,
  );
});

test("D1同時接続と日次書込みへ安全余裕を確保する", async () => {
  const contentJobs = await source("workers/content-jobs/index.ts");
  const serializer = await source("workers/shared/serializedD1.ts");
  const score = await source("workers/score-recalc/index.ts");
  const monitor = await source("src/lib/admin/workerMonitoring.ts");

  assert.match(contentJobs, /withSerializedD1\(env\)/);
  assert.match(serializer, /class AsyncGate/);
  assert.match(score, /SCORE_RECALC_BATCH_SIZE\s*=\s*150/);
  assert.match(monitor, /capacityPerDay:\s*14400/);
});

test("YouTube API副キーはcredential障害だけを補完する", async () => {
  const failover = await source("workers/youtube-sync/apiKeyFailover.ts");
  const sync = await source("workers/youtube-sync/index.ts");
  const syncJobs = await source("workers/sync-jobs/index.ts");
  const vars = await source(".dev.vars.example");
  const operations = await source("docs/operations/workers.md");
  const nav = await source("src/lib/admin/adminNavGroups.tsx");
  const page = await source("app/(admin)/admin/youtube-api-keys/page.tsx");
  const card = await source("src/components/admin/YoutubeApiKeyStatusCard.tsx");

  assert.match(failover, /YOUTUBE_API_KEY_SECONDARY/);
  assert.match(syncJobs, /YOUTUBE_API_KEY_SECONDARY/);
  assert.match(vars, /YOUTUBE_API_KEY_SECONDARY=""/);
  assert.match(failover, /requestError\?\.kind === "credential"/);
  assert.match(failover, /quota系を別キーへ逃がさない/);
  assert.match(sync, /ExternalRequestBudget\(YOUTUBE_MAX_QUOTA_UNITS_PER_RUN\)/);
  assert.match(operations, /quotaExceeded.*副キーへ切り替えない/);
  assert.match(failover, /youtube-api:key-status:v1/);
  assert.match(nav, /href:\s*"\/admin\/youtube-api-keys"/);
  assert.match(page, /YoutubeApiKeyStatusCard/);
  assert.match(card, /YouTube APIキー冗長化/);
  assert.doesNotMatch(card, /YOUTUBE_API_KEY(?:_SECONDARY)?/);
  assert.doesNotMatch(card, /candidate\.key/);
});
