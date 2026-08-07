import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readSource = (relativePath) =>
  readFile(new URL(relativePath, import.meta.url), "utf8");

test("CurrentUser は未連携の raw Active X ID を復活させない", async () => {
  const source = await readSource("./currentUser.ts");

  assert.match(source, /active_x_user_id:\s*resolvedActive,/);
  assert.doesNotMatch(source, /resolvedActive\s*\?\?/);
  assert.match(
    source,
    /const fallback: CurrentUser = \{[\s\S]*?active_x_user_id:\s*null,/,
  );
});

test("承認必須の共通ガードは Auth user 自身の承認済み X ID 集合を照合する", async () => {
  const source = await readSource("./writeGuard.ts");

  assert.match(
    source,
    /approvedXIds\s*=\s*await getApprovedXIds\(db, user\.id\)/,
  );
  assert.match(
    source,
    /try \{[\s\S]*?getApprovedXIds\(db, user\.id\)[\s\S]*?select\(\{ approval_status: xUsers\.approval_status \}\)[\s\S]*?catch \{\s*return deny\("db_unavailable"\);\s*\}/,
  );
  assert.match(
    source,
    /evaluateActiveXWriteAccess\(\{[\s\S]*?activeXId,[\s\S]*?approvalStatus: activeXApprovalStatus,[\s\S]*?approvedXIds,[\s\S]*?\}\)/,
  );
});

test("Active X 整合コアモジュールが存在する", async () => {
  await Promise.all([
    readSource("./activeXSnapshotCore.ts"),
    readSource("../slots/slotIdentityCore.ts"),
  ]);
});

test("作品提出・自由投稿・チャプター作成は validateActiveXSnapshot を呼ぶ", async () => {
  const [submitSlot, createFree, chapter] = await Promise.all([
    readSource("../actions/video/submitSlotVideo.ts"),
    readSource("../actions/video/createFreeVideo.ts"),
    readSource("../actions/chapter.ts"),
  ]);

  assert.match(submitSlot, /validateActiveXSnapshot/);
  assert.match(createFree, /validateActiveXSnapshot/);

  const createChapterStart = chapter.indexOf("export async function createChapter");
  const createChaptersBulkStart = chapter.indexOf(
    "export async function createChaptersBulk",
  );
  assert.ok(createChapterStart >= 0);
  assert.ok(createChaptersBulkStart > createChapterStart);
  const createChapterBody = chapter.slice(
    createChapterStart,
    createChaptersBulkStart,
  );
  assert.match(createChapterBody, /validateActiveXSnapshot/);
});

test("slot.ts は authUserControlsXId / ownsSlot を使わない", async () => {
  const slotSource = await readSource("../actions/slot.ts");
  assert.doesNotMatch(slotSource, /authUserControlsXId/);
  assert.doesNotMatch(slotSource, /ownsSlot/);
});

test("チャプターコメントは承認済み Active X ID を必須にする。like/bookmark は Auth user 単位で Active X を要求しない", async () => {
  const [chapterSource, interactionSource, currentUserSource] = await Promise.all([
    readSource("../actions/chapter.ts"),
    readSource("../actions/video/interaction.ts"),
    readSource("./currentUser.ts"),
  ]);

  assert.equal(
    chapterSource.match(/requireApprovedActiveXId:\s*true/g)?.length,
    4,
  );
  assert.match(
    interactionSource,
    /async function mutateVideoInteraction[\s\S]*?writeGuard\(\{[\s\S]*?requireActiveXId:\s*false,[\s\S]*?requireApprovedActiveXId:\s*false,[\s\S]*?feature:\s*"like_or_bookmark"/,
  );
  assert.match(interactionSource, /videoInteractionsAuth/);
  assert.match(currentUserSource, /resolveActiveXUserId/);
  assert.doesNotMatch(
    interactionSource,
    /async function mutateVideoInteraction[\s\S]*?requireApprovedActiveXId:\s*true/,
  );
  assert.match(interactionSource, /type InteractionKind = "like" \| "bookmark"/);
});
