import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [libraryPage, videoDetailPage, managePage] = await Promise.all([
  readFile(
    new URL("../../app/(auth)/dashboard/library/page.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../../app/(public)/[id]/page.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../../app/(manage)/manage/page.tsx", import.meta.url),
    "utf8",
  ),
]);

test("ライブラリ一覧はinteraction IDをINへ展開せず動画へ直接JOINする", () => {
  assert.match(
    libraryPage,
    /\.from\(videoInteractions\)[\s\S]*?\.innerJoin\(videosTable,\s*eq\(videosTable\.id, videoInteractions\.video_id\)\)/,
  );
  assert.match(
    libraryPage,
    /eq\(videoInteractions\.x_user_id, activeX\)[\s\S]*?eq\(videoInteractions\.interaction_type, tab\)[\s\S]*?ne\(videosTable\.visibility_status, "voided"\)/,
  );
  assert.doesNotMatch(libraryPage, /inArray\(videosTable\.id/);
});

test("動画詳細のライブラリplaylistも直接JOINし、overlay障害を認証済み利用者の未承認扱いにしない", () => {
  assert.match(
    videoDetailPage,
    /\.from\(videoInteractions\)[\s\S]*?\.innerJoin\([\s\S]*?videosTable,[\s\S]*?eq\(videosTable\.id, videoInteractions\.video_id\)/,
  );
  assert.match(
    videoDetailPage,
    /eq\(videoInteractions\.x_user_id, viewerActiveX\)[\s\S]*?eq\(videoInteractions\.interaction_type, kind\)[\s\S]*?eq\(videosTable\.visibility_status, "public"\)/,
  );
  assert.doesNotMatch(videoDetailPage, /inArray\(videosTable\.id/);
  assert.match(
    videoDetailPage,
    /authUnavailable:\s*authUnavailable \|\| Boolean\(authenticatedViewer\)/,
  );
});

test("運営トップは100件超のイベントIDをD1安全幅へ分割する", () => {
  const chunkSizeMatch = managePage.match(
    /const D1_SAFE_EVENT_ID_CHUNK_SIZE = (\d+);/,
  );
  assert.ok(chunkSizeMatch);
  assert.ok(Number(chunkSizeMatch[1]) > 0);
  assert.ok(Number(chunkSizeMatch[1]) < 100);

  assert.match(managePage, /chunkEventIds\(editableEventIds\)/);
  assert.ok(
    (managePage.match(/chunkEventIds\(eventIds\)/g) ?? []).length >= 4,
    "pending・audit・notification・staff roleをすべてchunkする",
  );
  assert.doesNotMatch(
    managePage,
    /inArray\([^\n]+,\s*(?:editableEventIds|eventIds)\s*\)/,
  );
  assert.match(
    managePage,
    /getManageStaffRolesForEvents\(db, user\.id, eventIdChunk\)/,
  );
});
