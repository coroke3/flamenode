import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [source, overviewSource, notificationsSource, xLinkSource] =
  await Promise.all([
    readFile(new URL("./navigationEvents.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../../../app/(manage)/manage/events/[id]/page.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../../../app/(manage)/manage/notifications/page.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../../../app/(manage)/manage/x-link-requests/page.tsx", import.meta.url),
      "utf8",
    ),
  ]);

test("manage navigation keeps sidebar and dashboard ordering as separate projections", () => {
  assert.match(source, /events: ManageNavigationEvent\[\]/);
  assert.match(source, /dashboardEvents: ManageNavigationEvent\[\]/);
  assert.match(source, /compareEventsByUpcomingPriority/);
  assert.match(source, /compareSidebarRows/);
  assert.match(source, /created_at: events\.created_at/);
});

test("pending navigation counts use the video_events primary-key shape and bounded ids", () => {
  assert.match(source, /D1_SAFE_EVENT_ID_CHUNK_SIZE = 80/);
  assert.match(source, /COUNT\(\*\)/);
  assert.match(source, /groupBy\(videoEvents\.event_id\)/);
  assert.doesNotMatch(source, /countDistinct/);
  assert.match(source, /getManageAuthorizationSnapshot/);
});

test("manage overview and auxiliary pages reuse request-local reads", () => {
  assert.match(overviewSource, /navigation\.events\.find\(\(event\) => event\.id === id\)/);
  assert.doesNotMatch(overviewSource, /await db\.select\(\)\.from\(eventsTable\)/);
  assert.match(notificationsSource, /getManageNavigationSnapshot/);
  assert.doesNotMatch(notificationsSource, /from\(eventsTable\)/);
  assert.match(notificationsSource, /D1_SAFE_EVENT_ID_CHUNK_SIZE = 80/);
  assert.match(notificationsSource, /chunkEventIds\(eventIds\)/);
  assert.match(
    notificationsSource,
    /candidates\s*\.sort\(\(left, right\) => right\.created_at - left\.created_at\)/,
  );
  assert.match(xLinkSource, /getManageAuthorizationSnapshot/);
  assert.doesNotMatch(xLinkSource, /canManageXIdLinkRequests\(/);
});
