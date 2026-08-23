import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(
  new URL("../../../app/(admin)/admin/api-endpoints/page.tsx", import.meta.url),
  "utf8",
);

test("作品情報出力APIの管理操作は結果を握りつぶさず成功・失敗を画面へ返す", () => {
  assert.match(page, /const result = await createApiEndpoint\(formData\)/);
  assert.match(page, /const result = await setApiEndpointActive\(formData\)/);
  assert.match(page, /result\.ok[\s\S]*pageHref\(\{ notice:/);
  assert.match(page, /pageHref\(\{ error:/);
  assert.match(page, /redirect\(/);
  assert.match(page, /sp\.notice/);
  assert.match(page, /sp\.error/);
  assert.match(page, /role="alert"/);
});
