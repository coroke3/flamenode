import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
const toml = await readFile(new URL("./wrangler.toml", import.meta.url), "utf8");
const sharedSource = await readFile(
  new URL("../shared/createCronWorker.ts", import.meta.url),
  "utf8",
);

test("background-jobsは1 Worker内で5分と1時間のCronを分離する", () => {
  assert.match(source, /FAST_CRON\s*=\s*"\*\/5 \* \* \* \*"/);
  assert.match(source, /HOURLY_CRON\s*=\s*"0 \* \* \* \*"/);
  assert.match(source, /event\.cron\s*===\s*FAST_CRON/);
  assert.match(source, /event\.cron\s*===\s*HOURLY_CRON/);
  assert.match(toml, /"\*\/5 \* \* \* \*"/);
  assert.match(toml, /"0 \* \* \* \*"/);
});

test("共通Cron WorkerはScheduledEventをrunnerへ渡す", () => {
  assert.match(sharedSource, /run\(env, event\)/);
  assert.match(source, /service:\s*"background-jobs"/);
});

test("外部APIとD1予算のため件数を固定する", () => {
  assert.match(source, /processNotificationQueue\(env, \{ limit: 6 \}\)/);
  assert.match(source, /limit:\s*10[\s\S]*realtimeOnly:\s*true/);
  assert.match(source, /syncBatch\(env, \{ limit: 50 \}\)/);
  assert.match(source, /recalcScoreBatch\(env, \{ limit: 50 \}\)/);
  assert.match(source, /STATIC_SKIP_NOTIFICATION_COUNT\s*=\s*4/);
  assert.match(source, /processStaticRebuildQueue[\s\S]*limit:\s*1/);
});
