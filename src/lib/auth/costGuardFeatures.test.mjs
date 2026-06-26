import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * costGuardFeatures.ts のテスト。
 *
 * costGuardFeatures.ts は `import "server-only"` を含むため、直接 import できない。
 * parseFeatureList のロジックを再実装してテストする。
 */

function parseFeatureList(raw, column) {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
      return v;
    }
    console.warn(
      `[costGuard] ${column} is not string[]; treating as empty (fail-open)`,
    );
    return [];
  } catch (e) {
    console.warn(
      `[costGuard] failed to parse ${column}; treating as empty (fail-open)`,
      e,
    );
    return [];
  }
}

// --- テスト ---

test("parseFeatureList: null → 空配列", () => {
  assert.deepEqual(parseFeatureList(null, "test"), []);
});

test("parseFeatureList: undefined → 空配列", () => {
  assert.deepEqual(parseFeatureList(undefined, "test"), []);
});

test("parseFeatureList: 空文字 → 空配列", () => {
  assert.deepEqual(parseFeatureList("", "test"), []);
});

test("parseFeatureList: 有効な JSON 配列 → 配列", () => {
  assert.deepEqual(
    parseFeatureList('["post_video_unslotted", "edit_video"]', "test"),
    ["post_video_unslotted", "edit_video"],
  );
});

test("parseFeatureList: 不正な JSON → 空配列 (fail-open)", () => {
  assert.deepEqual(parseFeatureList("{invalid", "test"), []);
});

test("parseFeatureList: 配列でない JSON → 空配列 (fail-open)", () => {
  assert.deepEqual(parseFeatureList('{"key": "value"}', "test"), []);
});

test("parseFeatureList: 数値を含む配列 → 空配列 (fail-open)", () => {
  assert.deepEqual(parseFeatureList('[1, 2, 3]', "test"), []);
});

test("parseFeatureList: 空配列 → 空配列", () => {
  assert.deepEqual(parseFeatureList("[]", "test"), []);
});

// --- セキュリティ: CostGuard のフェイルオープン確認 ---

test("セキュリティ: parseFeatureList は fail-open (全停止を避ける)", () => {
  const result = parseFeatureList("not-json", "test");
  assert.deepEqual(result, [], "不正 JSON でも空配列を返す");
});

test("セキュリティ: parseFeatureList は型チェックを行う", () => {
  const result = parseFeatureList("[123]", "test");
  assert.deepEqual(result, [], "数値配列は空配列を返す");
});
