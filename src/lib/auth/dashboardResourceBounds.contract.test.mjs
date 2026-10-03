import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboardPage = await readFile(
  new URL("../../../app/(auth)/dashboard/page.tsx", import.meta.url),
  "utf8",
);
const libraryPage = await readFile(
  new URL("../../../app/(auth)/dashboard/library/page.tsx", import.meta.url),
  "utf8",
);

test("dashboard SSR bounds gallery and chapter rendering", () => {
  assert.match(dashboardPage, /DASHBOARD_PREVIEW_LIMIT\s*=\s*8/);
  assert.ok(
    (dashboardPage.match(/\.limit\(DASHBOARD_PREVIEW_LIMIT \+ 1\)/g) ?? []).length >= 3,
    "own videos, collab videos, and chapters must all use a bounded preview query",
  );
  assert.match(dashboardPage, /\.selectDistinct\(/);
  assert.doesNotMatch(dashboardPage, /collabById|Array\.from\(collabById/);
});

test("dashboard event count is aggregated in D1 instead of materialized in Worker memory", () => {
  assert.match(dashboardPage, /db\.all\(sql`[\s\S]*?SELECT COUNT\(\*\) AS event_count/);
  assert.match(dashboardPage, /\bUNION\b/);
  assert.match(dashboardPage, /event_count: Number\(eventCountRow\?\.event_count/);
  assert.doesNotMatch(dashboardPage, /participatingEventIds|for \(const row of eventRows\)/);
});

test("full private content remains available through authenticated bounded pages", () => {
  assert.match(libraryPage, /requireSession/);
  assert.match(libraryPage, /DASHBOARD_LIBRARY_PAGE_SIZE\s*=\s*24/);
  assert.match(libraryPage, /DASHBOARD_LIBRARY_MAX_PAGE\s*=\s*500/);
  assert.match(libraryPage, /\.limit\(DASHBOARD_LIBRARY_PAGE_SIZE \+ 1\)/);
  assert.match(libraryPage, /\.offset\(offset\)/);
  assert.match(libraryPage, /"mine"/);
  assert.match(libraryPage, /"collab"/);
  assert.match(libraryPage, /"chapters"/);
  assert.match(libraryPage, /getOnboardingState/);
  assert.match(libraryPage, /approvedXIdsWhere/);
  assert.match(libraryPage, /approvedXIdsNotWhere/);
  assert.match(libraryPage, /eq\(xUserAccountLinks\.auth_user_id, user\.id\)/);
  assert.match(libraryPage, /eq\(videosTable\.creator_x_user_id, activeApprovedXId\)/);
});
