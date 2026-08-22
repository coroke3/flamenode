import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const formSource = await readFile(
  new URL("../../components/video/VideoStatusForm.tsx", import.meta.url),
  "utf8",
);
const approveSource = await readFile(
  new URL("../../components/video/VideoApproveActions.tsx", import.meta.url),
  "utf8",
);
const queueSource = await readFile(
  new URL("../../components/admin/VideoReviewQueueTable.tsx", import.meta.url),
  "utf8",
);
const detailSource = await readFile(
  new URL("../../components/admin/VideoReviewDetailPanel.tsx", import.meta.url),
  "utf8",
);
const quickApproveSource = await readFile(
  new URL("../../components/admin/VideoReviewQuickApproveButton.tsx", import.meta.url),
  "utf8",
);

test("VideoStatusForm catches rejected server actions", () => {
  assert.match(formSource, /try \{[\s\S]*result = await action\(fd\)/);
  assert.match(formSource, /catch \{[\s\S]*COMMUNICATION_ERROR_MESSAGE/);
  assert.match(formSource, /router\.refresh\(\)/);
  assert.match(formSource, /submitting/);
  assert.doesNotMatch(formSource, /useTransition/);
});

test("VideoApproveActions navigates via nextHref", () => {
  assert.match(approveSource, /result\.nextHref/);
  assert.match(approveSource, /router\.push\(result\.nextHref\)/);
  assert.match(approveSource, /currentStatus !== "pending"/);
});

test("VideoReviewQueueTable gates quick approve behind canApprove", () => {
  assert.match(queueSource, /canApprove/);
  assert.match(queueSource, /VideoReviewQuickApproveButton/);
  assert.match(queueSource, /visibility_status === "pending"/);
  assert.match(queueSource, /youtube_video_id\?\.trim\(\) \|\| null/);
  assert.match(queueSource, /!youtubeVideoId/);
});

test("review detail treats whitespace-only YouTube IDs as missing", () => {
  assert.match(detailSource, /youtube_video_id\?\.trim\(\) \|\| null/);
  assert.match(detailSource, /youtubeVideoId \? \(/);
  assert.match(detailSource, /!youtubeVideoId/);
});

test("VideoReviewQuickApproveButton guards double submit with submitting state", () => {
  assert.match(quickApproveSource, /submitting/);
  assert.doesNotMatch(quickApproveSource, /useTransition/);
});
