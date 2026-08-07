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

test("VideoStatusForm catches rejected server actions", () => {
  assert.match(formSource, /try \{[\s\S]*result = await action\(fd\)/);
  assert.match(formSource, /catch \{[\s\S]*COMMUNICATION_ERROR_MESSAGE/);
  assert.match(formSource, /router\.refresh\(\)/);
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
});
