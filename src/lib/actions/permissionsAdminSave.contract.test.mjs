import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("./permissions-admin.ts", import.meta.url),
  "utf8",
);

test("permissions-admin selects and patches only general editable field columns", () => {
  assert.match(source, /PERMISSION_SETTINGS_COLUMNS/);
  assert.match(source, /default_editable_fields: systemSettings\.default_editable_fields/);
  assert.match(source, /upcoming_editable_fields: systemSettings\.upcoming_editable_fields/);
  assert.doesNotMatch(source, /db\.select\(\)\.from\(systemSettings\)/);
  assert.match(source, /\.set\(patch\)/);
  assert.doesNotMatch(source, /expectedCurrent:\s*\{\s*\.\.\.before\s*\}/);
});

test("permissions-admin uses shared generalEditPermissions helpers", () => {
  assert.match(source, /from "@\/lib\/video\/generalEditPermissions"/);
  assert.match(source, /normalizeGeneralEditableFields/);
  assert.match(source, /serializeGeneralEditableFields/);
});

test("permissions-admin returns early when values are unchanged", () => {
  assert.match(source, /一般作品権限に変更はありません。/);
  assert.match(source, /settings: patch/);
  assert.match(source, /const norm = \(v: string \| null \| undefined\) => v \|\| ""/);
  const earlyReturnIndex = source.indexOf("一般作品権限に変更はありません。");
  const mutateIndex = source.indexOf("await mutateWithAudit(db");
  assert.ok(earlyReturnIndex !== -1);
  assert.ok(mutateIndex !== -1);
  assert.ok(earlyReturnIndex < mutateIndex);
});

test("permissions-admin audits only permission columns", () => {
  assert.match(source, /before: beforeSnapshot/);
  assert.match(source, /after: afterSnapshot/);
  assert.match(source, /snapshotPermissionSettings/);
});

test("permissions-admin distinguishes conflict vs audit failure", () => {
  assert.match(source, /AuditMutationError/);
  assert.match(
    source,
    /別の管理者が一般作品権限を更新しました。ページを再読み込みして、現在の設定を確認してください。/,
  );
  assert.match(
    source,
    /一般作品権限の保存に失敗しました。時間をおいて再度お試しください。/,
  );
});

test("permissions-admin does not auto-create default row", () => {
  assert.doesNotMatch(source, /\.insert\(systemSettings\)/);
  assert.match(
    source,
    /一般作品権限の設定行が見つかりません。DBマイグレーションの適用状態を確認してください。/,
  );
});
