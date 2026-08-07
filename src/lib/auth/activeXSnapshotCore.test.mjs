import assert from "node:assert/strict";
import { test } from "node:test";
import { validateActiveXSnapshot } from "./activeXSnapshotCore.ts";

const MESSAGE =
  "投稿画面を開いた後にActive X IDが変更されました。最新の活動名義を確認してからもう一度投稿してください。";

test("validateActiveXSnapshot: normalize 後の完全一致は ok", () => {
  assert.deepEqual(
    validateActiveXSnapshot({
      submittedSnapshot: "@Creator_A",
      currentActiveXId: "creator_a",
    }),
    { ok: true },
  );
  assert.deepEqual(
    validateActiveXSnapshot({
      submittedSnapshot: "Creator_A",
      currentActiveXId: "creator_a",
    }),
    { ok: true },
  );
});

test("validateActiveXSnapshot: 不一致は固定メッセージで fail", () => {
  const result = validateActiveXSnapshot({
    submittedSnapshot: "creator_a",
    currentActiveXId: "creator_b",
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.message, MESSAGE);
  }
});

test("validateActiveXSnapshot: submitted が空は fail", () => {
  const result = validateActiveXSnapshot({
    submittedSnapshot: null,
    currentActiveXId: "creator_a",
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.message, MESSAGE);
  }

  const emptyResult = validateActiveXSnapshot({
    submittedSnapshot: "",
    currentActiveXId: "creator_a",
  });
  assert.equal(emptyResult.ok, false);
});

test("validateActiveXSnapshot: current が空は fail", () => {
  const result = validateActiveXSnapshot({
    submittedSnapshot: "creator_a",
    currentActiveXId: null,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.message, MESSAGE);
  }

  const emptyResult = validateActiveXSnapshot({
    submittedSnapshot: "creator_a",
    currentActiveXId: "",
  });
  assert.equal(emptyResult.ok, false);
});

test("validateActiveXSnapshot: 両方空は fail", () => {
  const result = validateActiveXSnapshot({
    submittedSnapshot: null,
    currentActiveXId: null,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.message, MESSAGE);
  }
});
