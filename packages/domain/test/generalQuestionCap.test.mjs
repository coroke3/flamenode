import assert from "node:assert/strict";
import test from "node:test";
import { resolveGeneralCustomQuestionCap } from "@flamenode/domain/event";
import { MAX_GENERAL_CUSTOM_QUESTIONS } from "@flamenode/domain/event/limits";

test("MIG-0652: new event questions retain the canonical default cap", () => {
  assert.equal(MAX_GENERAL_CUSTOM_QUESTIONS, 4);
  assert.equal(resolveGeneralCustomQuestionCap({ existingCount: 0, templateCount: 0 }), 4);
  assert.equal(resolveGeneralCustomQuestionCap({ existingCount: 4, templateCount: 2 }), 4);
});

test("MIG-0652: older events and templates above cap remain visible", () => {
  assert.equal(resolveGeneralCustomQuestionCap({ existingCount: 7, templateCount: 1 }), 7);
  assert.equal(resolveGeneralCustomQuestionCap({ existingCount: 1, templateCount: 9 }), 9);
  assert.equal(resolveGeneralCustomQuestionCap({ existingCount: 8, templateCount: 9 }), 9);
});

test("MIG-0652: equal and negative counts retain CURRENT Math.max behavior", () => {
  assert.equal(resolveGeneralCustomQuestionCap({ existingCount: 4, templateCount: 4 }), 4);
  assert.equal(resolveGeneralCustomQuestionCap({ existingCount: -1, templateCount: 0 }), 4);
});
