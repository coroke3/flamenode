import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const editPage = readFileSync(
  fileURLToPath(new URL(
    "../../../app/(auth)/dashboard/edit/[id]/page.tsx",
    import.meta.url,
  )),
  "utf8",
);

test("追加質問の編集権限がない場合は質問をフォーム検証へ渡さない", () => {
  assert.match(editPage, /const questionsByEvent = sections\.descriptions/);
  assert.match(editPage, /: new Map\(\)/);
  assert.match(editPage, /const customAnswerValues = sections\.descriptions/);
});
