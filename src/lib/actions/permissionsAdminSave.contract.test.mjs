import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [source, baselineMigration, canonicalMigration] = await Promise.all([
  readFile(new URL("./permissions-admin.ts", import.meta.url), "utf8"),
  readFile(
    new URL("../../../migrations/0000_flame_node_baseline.sql", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../../../migrations/0043_db_canonical_migration.sql", import.meta.url),
    "utf8",
  ),
]);

test("一般作品権限の保存は対象2列だけをCAS比較する", () => {
  assert.match(source, /const permissionSettingsSelect = \{/);
  assert.match(source, /default_editable_fields: systemSettings\.default_editable_fields/);
  assert.match(source, /upcoming_editable_fields: systemSettings\.upcoming_editable_fields/);
  assert.match(source, /\.select\(permissionSettingsSelect\)/);
  assert.match(
    source,
    /const permissionCasSnapshot = \{[\s\S]*?default_editable_fields:[\s\S]*?upcoming_editable_fields:/,
  );
  assert.match(source, /expectedCurrent: permissionCasSnapshot/);
  assert.doesNotMatch(source, /expectedCurrent:\s*\{\s*\.\.\.before\s*\}/);
  assert.doesNotMatch(
    source,
    /permissionCasSnapshot = \{[\s\S]*?operation_mode:/,
  );
});

test("同じ値の再保存は監査付きUPDATEを発行せず成功する", () => {
  assert.match(
    source,
    /before\.default_editable_fields === patch\.default_editable_fields[\s\S]*?before\.upcoming_editable_fields === patch\.upcoming_editable_fields/,
  );
  assert.match(source, /一般作品権限に変更はありません/);
});

test("設定行欠損時は無言で空設定を保存せずmigration確認を案内する", () => {
  assert.match(source, /if \(!before\)/);
  assert.match(source, /DBマイグレーションの適用状態を確認してください/);
});

test("新規DBと正本移行の両方でsystem_settings default行を保証する", () => {
  assert.match(
    baselineMigration,
    /INSERT INTO "system_settings"[\s\S]*?VALUES \('default'/,
  );
  assert.match(
    canonicalMigration,
    /INSERT INTO system_settings_new \(id\)[\s\S]*?SELECT 'default'[\s\S]*?WHERE NOT EXISTS/,
  );
});
