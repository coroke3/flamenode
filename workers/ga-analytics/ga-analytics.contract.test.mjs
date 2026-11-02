import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("ga-analytics keeps ranking pure, and uses D1 only in bounded recent-source loader", async () => {
  const ranking = await read("./ranking.ts");
  const sync = await read("./sync.ts");
  const syncJobs = await read("../sync-jobs/index.ts");
  const recentFromD1 = await read("./recentFromD1.ts");

  assert.doesNotMatch(ranking, /env\.DB|D1Database|\.prepare\(/);
  assert.match(sync, /loadRecentListFromD1\(env\.DB/);
  assert.doesNotMatch(sync, /GA4_RECENT_LIST_KEY|list\/recent\.json/);
  assert.match(recentFromD1, /COUNTABLE_PUBLIC_VIDEO_SQL/);
  assert.match(recentFromD1, /LIMIT \?/);
  assert.match(syncJobs, /ga4-trending-sync/);
  assert.match(syncJobs, /syncGa4Trending\(budgetEnv, signal\)/);
  assert.match(syncJobs, /rethrow:\s*false/);
  const cronBlock = syncJobs.slice(syncJobs.indexOf("export async function runSyncJobs"));
  const ga4Index = cronBlock.indexOf("ga4-trending-sync");
  const youtubeIndex = cronBlock.indexOf("youtube-sync-metadata");
  assert.ok(ga4Index > 0 && youtubeIndex > 0);
  assert.ok(ga4Index < youtubeIndex);
  assert.doesNotMatch(
    syncJobs,
    /isPlaylistSyncSlot[\s\S]{0,400}ga4-trending-sync/,
  );
});
