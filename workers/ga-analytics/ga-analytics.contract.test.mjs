import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("ga-analytics ranking and sync do not reference D1 or env.DB", async () => {
  const ranking = await read("./ranking.ts");
  const sync = await read("./sync.ts");
  const syncJobs = await read("../sync-jobs/index.ts");

  assert.doesNotMatch(ranking, /env\.DB|D1Database|\.prepare\(/);
  assert.doesNotMatch(sync, /env\.DB|D1Database|\.prepare\(/);
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
