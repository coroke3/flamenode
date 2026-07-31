import assert from "node:assert/strict";
import test from "node:test";
import {
  appendPublicReflectionDelayNotice,
  markPendingPublicReflection,
  PUBLIC_REFLECTION_DELAY_MESSAGE,
  withPublicReflectionDelayMessage,
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

test("withPublicReflectionDelayMessage は案内文を重複付与しない", () => {
  const once = withPublicReflectionDelayMessage("保存しました。", true);
  assert.equal(once.pendingPublicReflection, true);
  assert.match(once.message, new RegExp(PUBLIC_REFLECTION_DELAY_MESSAGE));

  const twice = appendPublicReflectionDelayNotice(once.message);
  assert.equal(
    (twice.match(new RegExp(PUBLIC_REFLECTION_DELAY_MESSAGE, "g")) ?? []).length,
    1,
  );
});
