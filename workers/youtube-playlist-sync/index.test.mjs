import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { calculateSyncDiff } from "./index.ts";

const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
const remote = [
  { playlist_item_id: "item-a", youtube_video_id: "video-a" },
  { playlist_item_id: "item-old", youtube_video_id: "video-old" },
];

test("worker module loads in Node strip-only mode", () => {
  assert.equal(typeof calculateSyncDiff, "function");
});

test("append_only adds missing videos without deleting remote items", () => {
  const diff = calculateSyncDiff(["video-a", "video-b"], remote, "append_only");
  assert.deepEqual(diff.additions, ["video-b"]);
  assert.deepEqual(diff.removals, []);
});

test("missing videos preserve source schedule order", () => {
  const diff = calculateSyncDiff(
    ["video-first", "video-a", "video-middle", "video-last"],
    remote,
    "append_only",
  );
  assert.deepEqual(diff.additions, [
    "video-first",
    "video-middle",
    "video-last",
  ]);
});

test("mirror adds missing videos and removes videos outside the event", () => {
  const diff = calculateSyncDiff(["video-a", "video-b"], remote, "mirror");
  assert.deepEqual(diff.additions, ["video-b"]);
  assert.deepEqual(diff.removals, [remote[1]]);
});

test("playlist外部呼出しは共通timeoutと固定予算を使う", () => {
  assert.match(source, /from "\.\.\/shared\/externalApi\.ts"/);
  assert.match(source, /MAX_EXTERNAL_REQUESTS_PER_RUN = 12/);
  assert.match(source, /new ExternalRequestBudget\(MAX_EXTERNAL_REQUESTS_PER_RUN\)/);
  assert.doesNotMatch(source, /async function fetchWithTimeout/);
});

test("OAuth tokenをisolate内で期限付き再利用し401で破棄する", () => {
  assert.match(source, /__flamenodeYoutubePlaylistAccessToken/);
  assert.match(source, /OAUTH_TOKEN_SAFETY_MS/);
  assert.match(source, /response\.status === 401/);
  assert.match(source, /clearCachedAccessToken\(\)/);
});

test("playlist APIはpartial responseとcompact JSONを使う", () => {
  assert.match(source, /nextPageToken,items\(id,snippet\/resourceId\/videoId\)/);
  assert.match(source, /url\.searchParams\.set\("fields", "id"\)/);
  assert.ok((source.match(/prettyPrint/g) ?? []).length >= 3);
});

test("source重複排除とD1保存はDB側でまとめる", () => {
  assert.match(source, /GROUP BY v\.youtube_video_id/);
  assert.doesNotMatch(source, /new Set\(rows\.map/);
  assert.match(source, /env\.DB\.batch\(statements\)/);
  assert.match(source, /env\.DB\.batch\([\s\S]*DELETE FROM event_youtube_playlist_items/);
});

test("無効な制御処理と線形indexOfを残さない", () => {
  assert.doesNotMatch(source, /async persist\(\)/);
  assert.doesNotMatch(source, /quota\.persist\(\)/);
  assert.doesNotMatch(source, /sourceVideoIds\.indexOf/);
  assert.match(source, /const sourcePositions = new Map/);
});
