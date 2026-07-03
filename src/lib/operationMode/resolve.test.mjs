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

test("resolveOperationMode: operation_mode を正本として優先する", () => {
  assert.equal(
    resolveOperationMode({
      operation_mode: "read_only",
      cost_guard_mode: "normal",
      is_maintenance_mode: 0,
    }),
    "read_only",
  );
});

test("resolveOperationMode: operation_mode 不正時は cost_guard_mode へ fallback", () => {
  assert.equal(
    resolveOperationMode({
      operation_mode: "broken",
      cost_guard_mode: "static_only",
      is_maintenance_mode: 0,
    }),
    "static_only",
  );
});

test("resolveOperationMode: 旧 maintenance flag は安全側で maintenance", () => {
  assert.equal(
    resolveOperationMode({
      operation_mode: "normal",
      cost_guard_mode: "normal",
      is_maintenance_mode: 1,
    }),
    "maintenance",
  );
});

test("resolveOperationMode: 行がなければ normal", () => {
  assert.equal(resolveOperationMode(null), "normal");
  assert.equal(resolveOperationMode(undefined), "normal");
  assert.equal(resolveOperationMode({ operation_mode: "broken" }), "normal");
});
