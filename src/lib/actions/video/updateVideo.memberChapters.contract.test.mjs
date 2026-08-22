import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./updateVideo.ts", import.meta.url), "utf8");

test("members-only update projects chapter checks and writes through identity", () => {
  assert.match(source, /remapMemberChaptersByIdentity\(/);
  assert.match(
    source,
    /const canEditMembersField =\s*[\s\S]*?const canEditChaptersField =\s*[\s\S]*?if \(canEditMembersField && !canEditChaptersField\) \{[\s\S]*?remapMemberChaptersByIdentity\([\s\S]*?memberChaptersPayloadChanged\(existingMemberBaseline, chapterComparisonBaseline\)/,
  );
  assert.match(
    source,
    /chaptersByIndex:\s*memberChapterRemap\?\.bySubmittedIndex \?\?/,
  );
});

test("normal-mode follow-up check uses the identity-remapped chapter baseline", () => {
  assert.match(
    source,
    /memberChaptersPayloadChanged\(\s*existingMemberBaseline,\s*chapterComparisonBaseline \?\? submittedMemberBaseline,\s*\)/,
  );
});
