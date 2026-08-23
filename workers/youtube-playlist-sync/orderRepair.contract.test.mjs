import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
const action = await readFile(
  new URL("../../src/lib/actions/event-youtube-playlist.ts", import.meta.url),
  "utf8",
);

test("既存playlist itemの順序補正はYouTube update APIをboundedに使う", () => {
  assert.match(source, /method:\s*"PUT"/);
  assert.match(source, /MAX_ORDER_REPAIRS_PER_RUN = 2/);
  assert.match(source, /MAX_ORDER_SCAN_PAGES_PER_EVENT = 8/);
  assert.match(source, /requestBudget\.remaining <= 1/);
  assert.match(source, /quota\.canSpend\(51\)/);
  assert.match(source, /sourceVideoIds\.length > 1/);
  assert.match(source, /playlist_order_repair_continuing/);
  assert.match(source, /playlist_order_fallback_manual_sort_required/);
});

test("外部request budget枯渇時はYouTube quotaを先に予約しない", () => {
  assert.match(
    source,
    /if \(requestBudget\.remaining <= 0\)[\s\S]*youtube_playlist_request_budget_exhausted[\s\S]*await quota\.spend\(cost\)/,
  );
  assert.match(source, /requestBudget\.remaining < 2[\s\S]*!quota\.canSpend\(100\)/);
  assert.match(source, /requestBudget\.remaining <= 0[\s\S]*!quota\.canSpend\(50\)/);
});

test("手動同期予約はfull scan stateを破棄してremote順を再確認する", () => {
  assert.match(action, /last_full_scan_at:\s*null/);
  assert.match(action, /scan_started_at:\s*null/);
  assert.match(action, /scan_page_token:\s*null/);
  assert.match(action, /sendYoutubePlaylistSyncWakeBestEffort\("manage"\)/);
});
