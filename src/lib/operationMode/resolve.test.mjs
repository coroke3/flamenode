import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isOperationMode,
  normalizeOperationMode,
  resolveOperationMode,
} from "./resolve.ts";

test("isOperationMode: 有効な運用モードだけ true", () => {
  for (const mode of ["normal", "economy", "read_only", "static_only", "maintenance"]) {
    assert.equal(isOperationMode(mode), true, `${mode} should be valid`);
  }
  for (const mode of ["", "readonly", "cost_guard", null, 1]) {
    assert.equal(isOperationMode(mode), false, `${String(mode)} should be invalid`);
  }
});

test("normalizeOperationMode: 不正値は null", () => {
  assert.equal(normalizeOperationMode("economy"), "economy");
  assert.equal(normalizeOperationMode("unknown"), null);
  assert.equal(normalizeOperationMode(undefined), null);
});

test("resolveOperationMode: operation_mode のみ参照する", () => {
  assert.equal(
    resolveOperationMode({ operation_mode: "read_only" }),
    "read_only",
  );
});

test("resolveOperationMode: 行がなければ normal", () => {
  assert.equal(resolveOperationMode(null), "normal");
  assert.equal(resolveOperationMode(undefined), "normal");
  assert.equal(resolveOperationMode({ operation_mode: "broken" }), "normal");
});
