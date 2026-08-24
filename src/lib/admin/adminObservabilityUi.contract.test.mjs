import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

async function source(path) {
  return readFile(new URL(`../../../${path}`, import.meta.url), "utf8");
}

test("Worker監視のYouTube行は最古pending時刻をNULL安全に表示する", async () => {
  const page = await source("app/(admin)/admin/workers/page.tsx");

  assert.match(page, /<TimeCell value=\{snapshot\.youtube\.oldestPendingAt\} \/>/);
  assert.doesNotMatch(page, /snapshot\.youtube\.oldestSyncedAt/);
});

test("Admin playlist一覧は表示対象100件を共通health順で安定ソートする", async () => {
  const page = await source(
    "app/(admin)/admin/youtube-sync/playlists/page.tsx",
  );

  assert.match(page, /derivePlaylistSyncHealth\(\{/);
  assert.match(page, /left\.health\.priority - right\.health\.priority/);
  assert.match(page, /left\.originalIndex - right\.originalIndex/);
  assert.match(page, /HEALTH_REASON_LABELS\[row\.health\.reason\]/);
  assert.match(page, /健全性順は表示中の100件内/);
  assert.equal((page.match(/\.from\(eventYoutubePlaylistSync\)/g) ?? []).length, 1);
  assert.equal((page.match(/\.from\(videoEvents\)/g) ?? []).length, 1);
});

test("Manage playlistは設定と作品集計を各1 queryで読み共通healthを表示する", async () => {
  const page = await source(
    "app/(manage)/manage/events/[id]/youtube-playlist/page.tsx",
  );

  assert.match(page, /const \[configRows, countRows\] = await Promise\.all\(\[/);
  assert.equal((page.match(/\.from\(eventYoutubePlaylistSync\)/g) ?? []).length, 1);
  assert.equal((page.match(/\.from\(videoEvents\)/g) ?? []).length, 1);
  assert.match(page, /COUNT\(DISTINCT CASE[\s\S]*eligible_count/);
  assert.match(page, /derivePlaylistSyncHealth\(\{/);
  assert.match(page, /healthClass\(syncHealth\.level\)/);
});

test("YouTube playlist設定の日時はtruthyではなくNULLを明示判定する", async () => {
  const page = await source(
    "app/(manage)/manage/events/[id]/youtube-playlist/page.tsx",
  );

  for (const field of ["last_synced_at", "last_full_scan_at", "next_sync_at"]) {
    assert.match(page, new RegExp(`config\\?\\.${field} == null`));
    assert.doesNotMatch(
      page,
      new RegExp(`config\\?\\.${field} \\? formatUnix`),
    );
  }
});

test("Admin通知はprocessingリースのNULL欠損も警告対象にする", async () => {
  const page = await source("app/(admin)/admin/notifications/page.tsx");

  assert.match(page, /isNull\(notificationOutbox\.lease_expires_at\)/);
  assert.match(page, /lte\(notificationOutbox\.lease_expires_at, now\)/);
  assert.match(page, /配送リース期限超過・欠損/);
});

test("通知受信者のNULLは一括参照とMap lookupの前に除外する", async () => {
  const [adminPage, managePage] = await Promise.all([
    source("app/(admin)/admin/notifications/page.tsx"),
    source("app/(manage)/manage/notifications/page.tsx"),
  ]);

  for (const page of [adminPage, managePage]) {
    assert.match(
      page,
      /\.filter\(\(recipientId\): recipientId is string => recipientId != null\)/,
    );
    assert.match(page, /recipient_user_id == null[\s\S]*\? null/);
  }
});
