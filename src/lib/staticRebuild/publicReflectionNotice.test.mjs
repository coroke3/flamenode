import assert from "node:assert/strict";
import test from "node:test";
import {
  appendPublicReflectionDelayNotice,
  markPendingPublicReflection,
  PUBLIC_REFLECTION_DELAY_MESSAGE,
} from "./publicReflectionNotice.ts";

test("markPendingPublicReflection は enqueue 時だけフラグを付ける", () => {
  assert.deepEqual(
    markPendingPublicReflection({ ok: true, message: "保存しました。" }, false),
    { ok: true, message: "保存しました。" },
  );
  assert.deepEqual(
    markPendingPublicReflection({ ok: true }, true),
    { ok: true, pendingPublicReflection: true },
  );
  assert.deepEqual(
    markPendingPublicReflection({ ok: false }, true),
    { ok: false },
  );
});

test("appendPublicReflectionDelayNotice は案内文を重複付与しない", () => {
  const once = appendPublicReflectionDelayNotice("保存しました。");
  assert.match(once, new RegExp(PUBLIC_REFLECTION_DELAY_MESSAGE));

  const twice = appendPublicReflectionDelayNotice(once);
  assert.equal(
    (twice.match(new RegExp(PUBLIC_REFLECTION_DELAY_MESSAGE, "g")) ?? []).length,
    1,
  );
});
