import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const releaseViewSource = await readFile(
  new URL("../../../app/(public)/event/[id]/release/ReleaseView.tsx", import.meta.url),
  "utf8",
);
const releasePageSource = await readFile(
  new URL("../../../app/(public)/event/[id]/release/page.tsx", import.meta.url),
  "utf8",
);

test("Release view keeps list/grid/creator modes synchronized with the URL hash", () => {
  assert.match(releaseViewSource, /type ViewMode = "list" \| "grid" \| "creator"/);
  assert.match(releaseViewSource, /useState<ViewMode>\("list"\)/);
  assert.match(releaseViewSource, /syncModeHash/);
  assert.match(releaseViewSource, /window\.location\.hash/);
  assert.match(releaseViewSource, /window\.history\.replaceState/);
  assert.match(releaseViewSource, /mode === "list"/);
  assert.match(releaseViewSource, /mode === "grid"/);
  assert.match(releaseViewSource, /aria-label="作者別表示"/);
  assert.match(releaseViewSource, /aria-label="リスト表示"/);
  assert.match(releaseViewSource, /aria-label="カード表示"/);
});

test("Release view does not throw on invalid dates, YouTube ids, or DOM clones", () => {
  assert.match(releaseViewSource, /unixToDate/);
  assert.match(releaseViewSource, /ja-JP-u-ca-gregory/);
  assert.match(releaseViewSource, /extractYoutubeId/);
  assert.match(releaseViewSource, /video\.members \?\? \[\]/);
  assert.doesNotMatch(releaseViewSource, /cloneNode/);
});

test("Release view exposes the public creator and member fields without private DTOs", () => {
  assert.match(releaseViewSource, /creator_x_user_id/);
  assert.match(releaseViewSource, /members\.map/);
  assert.match(releaseViewSource, /member\.role/);
  assert.match(releaseViewSource, /member\.comment/);
  assert.doesNotMatch(releaseViewSource, /submitted_by_user_id|auth_user_id|can_edit/);
});

test("Release page follows PVSF copy and avoids fn-btn controls", () => {
  assert.match(releasePageSource, /投稿予定のご案内/);
  assert.match(releasePageSource, /<div className=\{styles\.page\}>/);
  assert.doesNotMatch(releasePageSource, /fn-public-container/);
  assert.doesNotMatch(releasePageSource, /fn-page/);
  assert.doesNotMatch(releasePageSource, /fn-btn/);
  assert.doesNotMatch(releasePageSource, /RELEASE/);
  assert.doesNotMatch(releasePageSource, /イベント詳細へ/);
});

test("Release view uses PVSF list/grid/creator structure and youtubeThumbUrl", () => {
  assert.match(releaseViewSource, /name="menu"/);
  assert.doesNotMatch(releaseViewSource, /name="list"/);
  assert.match(releaseViewSource, /youtubeThumbUrl/);
  assert.match(releaseViewSource, /個人参加/);
  assert.match(releaseViewSource, /グループ参加/);
  assert.match(releaseViewSource, /複数人/);
  assert.match(releaseViewSource, /個人/);
  assert.match(releaseViewSource, /視聴/);
  assert.match(releaseViewSource, /詳細/);
  assert.doesNotMatch(releaseViewSource, /fn-btn/);
});
