import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * videoEditSections.ts のテスト。
 *
 * videoEditSections.ts は型定義のみのため、実行時の動作はない。
 * しかし、モジュールとして正しく import できることを確認する。
 */

test("videoEditSections: モジュールとして import できる", async () => {
  const mod = await import("./videoEditSections.ts");
  assert.ok(mod, "モジュールが定義されている");
});
