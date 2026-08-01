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

test("チャプターコメントは承認済み Active X ID を必須にする。like/bookmark は writeGuard で active X を要求し currentUser が承認済みに制限する", async () => {
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
    /async function mutateVideoInteraction[\s\S]*?writeGuard\(\{[\s\S]*?requireActiveXId:\s*true,[\s\S]*?requireApprovedActiveXId:\s*false,[\s\S]*?feature:\s*"like_or_bookmark"/,
  );
  assert.match(interactionSource, /resolveActiveXUserId/);
  assert.match(currentUserSource, /resolveActiveXUserId/);
  assert.doesNotMatch(
    interactionSource,
    /async function mutateVideoInteraction[\s\S]*?requireApprovedActiveXId:\s*true/,
  );
  assert.match(interactionSource, /type InteractionKind = "like" \| "bookmark"/);
});
