import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [usersPage, enrichment, videosPage, pendingCounts, notifications, auditPage, eventsPage, eventStatus, schemaBase, migration] = await Promise.all([
  readFile(new URL("../../../app/(admin)/admin/users/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("./adminXUserEnrichment.ts", import.meta.url), "utf8"),
  readFile(new URL("../../../app/(admin)/admin/videos/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("./adminPendingCounts.ts", import.meta.url), "utf8"),
  readFile(new URL("../../../app/(admin)/admin/notifications/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../../../app/(admin)/admin/audit/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../../../app/(admin)/admin/events/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../utils/eventStatus.ts", import.meta.url), "utf8"),
  readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  readFile(new URL("../../../migrations/0055_notification_outbox_latest_idx.sql", import.meta.url), "utf8"),
]);

test("admin users は view ごとに不要な一覧読取を実行しない", () => {
  assert.match(usersPage, /activeView === "permissions"/);
  assert.match(usersPage, /activeView === "xid"/);
  assert.match(usersPage, /loadAdminXUserEnrichment/);
  assert.doesNotMatch(usersPage, /resolveMissingIcons/);
  assert.doesNotMatch(usersPage, /primary_auth_user_image/);
  assert.doesNotMatch(usersPage, /primary_auth_user_id:\s*sql/);
  assert.match(usersPage, /const active = activeId\s*\?/);
});

test("X ID enrichment は owner優先と linked/active 条件をbatchで維持する", () => {
  assert.match(enrichment, /inArray\(xUserAccountLinks\.x_user_id, ids\)/);
  assert.match(enrichment, /a\.link_role === "owner"/);
  assert.match(enrichment, /a\.created_at - b\.created_at/);
  assert.match(enrichment, /a\.auth_user_id/);
  assert.match(enrichment, /normalizeXId\(row\.active_x_user_id\)/);
  assert.match(enrichment, /activeHolders\.add/);
});

test("X ID enrichment は joined user state を再利用し、active null を holder に数えない", () => {
  assert.match(enrichment, /active_x_user_id: users\.active_x_user_id/);
  assert.match(enrichment, /row\.active_x_user_id !== null/);
  assert.doesNotMatch(enrichment, /const activeHolderRows = await db/);
});

test("孤児ownerリンクでも旧primary ID/nameの選択規則を維持する", () => {
  assert.match(enrichment, /auth_user_exists: users\.id/);
  assert.match(enrichment, /primary_auth_user_id: primary\?\.auth_user_id/);
  assert.match(enrichment, /rows\.find\(\(row\) => row\.auth_user_exists !== null\)/);
  assert.match(enrichment, /primary_auth_user_name: primaryName\?\.auth_user_name/);
});

test("通常の作品一覧では review metadata を読まない", () => {
  assert.match(videosPage, /const useReviewTable = videoVisibilityGroupForFilter\(status\) === "review"/);
  assert.match(videosPage, /useReviewTable && db && rows\.length > 0/);
});

test("admin videos は q なしの一覧・件数で x_users JOIN を省略する", () => {
  assert.match(videosPage, /const withCreatorJoin = q\s*\n\s*\? base\.leftJoin/);
  assert.match(videosPage, /const countWithCreatorJoin = q\s*\n\s*\? countBase\.leftJoin/);
  assert.match(videosPage, /like\(xUsersTable\.x_name, term\)/);
  assert.match(videosPage, /const countWithJoin = event/);
});

test("管理トップの集計は operational status だけを対象にする", () => {
  assert.match(pendingCounts, /eq\(xIdentityRequestsTable\.status, "pending"\)/);
  assert.match(pendingCounts, /inArray\(notificationOutboxTable\.status, \["failed", "processing"\]\)/);
  assert.match(pendingCounts, /eq\(videoModerationCasesTable\.status, "open"\)/);
  assert.match(pendingCounts, /reservedOpenSlots/);
  assert.match(pendingCounts, /acceptingEntriesWhere\(now\)/);
  assert.match(pendingCounts, /\.from\(slotsTable\)/);
  assert.match(pendingCounts, /\.innerJoin\(eventsTable, eq\(eventsTable\.id, slotsTable\.event_id\)\)/);
  assert.doesNotMatch(pendingCounts, /COALESCE\([^)]*entry_(start|end)_time/);
});

test("通知一覧は全履歴 GROUP BY を行わず最新100件と運用件数を読む", () => {
  assert.match(notifications, /\.orderBy\(desc\(notificationOutbox\.created_at\)\)/);
  assert.match(notifications, /\.limit\(100\)/);
  assert.doesNotMatch(notifications, /groupBy\(notificationOutbox\.status\)/);
  assert.match(notifications, /operationalCounts/);
  assert.match(notifications, /SUM\(CASE WHEN .*notificationOutbox\.status/);
  assert.match(notifications, /inArray\(notificationOutbox\.status, \[\s*"pending",[\s\S]*"dead_letter"/);
  assert.match(notifications, /dead_letter/);
  assert.match(notifications, /rows\.length > 0/);
  assert.doesNotMatch(notifications, /statusCounts/);
  assert.doesNotMatch(notifications, /counts\.sent/);
});

test("監査 actor は canonical と legacy operator を受け付け、新規リンクは actor を使う", async () => {
  const usersPageSource = await readFile(new URL("../../../app/(admin)/admin/users/page.tsx", import.meta.url), "utf8");
  const tabsSource = await readFile(new URL("../../components/admin/AdminUserTabs.tsx", import.meta.url), "utf8");
  assert.match(auditPage, /sp\.actor \?\? sp\.operator/);
  assert.match(usersPageSource, /admin\/audit\?actor=/);
  assert.match(tabsSource, /admin\/audit\?actor=/);
});

test("accepting event の SQL helper と一覧フィルタを用意する", () => {
  assert.match(eventStatus, /export function acceptingEntriesWhere/);
  assert.match(eventStatus, /entry_start_time/);
  assert.match(eventStatus, /entry_end_time/);
  assert.match(eventsPage, /filter === "accepting" \? acceptingEntriesWhere\(now\)/);
});

test("通知最新一覧の全件scan + sortを防ぐ index をschema/migrationへ反映する", () => {
  assert.match(schemaBase, /notificationOutbox/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS notification_outbox_created_idx/);
  assert.match(migration, /ON notification_outbox\(created_at DESC\)/);
});
