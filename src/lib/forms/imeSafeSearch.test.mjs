import assert from "node:assert/strict";
import { test } from "node:test";
import {
  IME_COMPOSING_FORM_ATTR,
  isImeComposingForm,
  shouldBlockSearchFormSubmit,
  shouldBlockSearchKeySubmit,
} from "./imeSafeSearch.ts";

test("composing + Enter → submit 抑制", () => {
  assert.equal(
    shouldBlockSearchKeySubmit({ key: "Enter", isComposing: true }),
    true,
  );
});

test("composing + Shift+Enter → submit 抑制", () => {
  assert.equal(
    shouldBlockSearchKeySubmit({
      key: "Enter",
      shiftKey: true,
      isComposing: true,
    }),
    true,
  );
});

test("composition session + Enter → submit 抑制", () => {
  assert.equal(
    shouldBlockSearchKeySubmit({
      key: "Enter",
      isCompositionSession: true,
    }),
    true,
  );
});

test("keyCode 229 + Enter → submit 抑制", () => {
  assert.equal(
    shouldBlockSearchKeySubmit({ key: "Enter", keyCode: 229 }),
    true,
  );
});

test("non-composing + Enter → submit 許可", () => {
  assert.equal(
    shouldBlockSearchKeySubmit({ key: "Enter", isComposing: false }),
    false,
  );
});

test("non-composing + Shift+Enter → same-tab submit 許可", () => {
  assert.equal(
    shouldBlockSearchKeySubmit({
      key: "Enter",
      shiftKey: true,
      isComposing: false,
    }),
    false,
  );
});

test("button submit（form submit）は composition 中だけ抑止", () => {
  assert.equal(shouldBlockSearchFormSubmit({ isCompositionSession: true }), true);
  assert.equal(
    shouldBlockSearchFormSubmit({ isCompositionSession: false }),
    false,
  );
});

test("isImeComposingForm は composing 属性の有無を返す", () => {
  const withAttr = {
    hasAttribute(name) {
      return name === IME_COMPOSING_FORM_ATTR;
    },
  };
  const withoutAttr = {
    hasAttribute() {
      return false;
    },
  };
  assert.equal(isImeComposingForm(withAttr), true);
  assert.equal(isImeComposingForm(withoutAttr), false);
});

test("stale composition が終われば次回検索は有効", () => {
  assert.equal(
    shouldBlockSearchKeySubmit({
      key: "Enter",
      isCompositionSession: false,
      isComposing: false,
    }),
    false,
  );
});
