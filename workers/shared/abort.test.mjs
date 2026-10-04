import assert from "node:assert/strict";
import { test } from "node:test";
import { abortError, abortGuard, throwIfAborted } from "./abort.ts";

test("throwIfAborted rethrows the signal's Error reason unchanged", () => {
  const reason = new Error("cron wall-clock deadline exceeded: 1000ms");
  const controller = new AbortController();
  controller.abort(reason);
  assert.throws(
    () => throwIfAborted(controller.signal, "fallback"),
    (error) => error === reason,
  );
});

test("non-Error reasons are wrapped so callers always receive an Error", () => {
  const controller = new AbortController();
  controller.abort("lease lost");
  const error = abortError(controller.signal, "fallback");
  assert.ok(error instanceof Error);
  assert.equal(error.message, "lease lost");
});

test("a signal-like object without a reason uses the fallback message", () => {
  const signal = { aborted: true, reason: undefined };
  assert.throws(() => throwIfAborted(signal, "static rebuild aborted"), {
    message: "static rebuild aborted",
  });
});

test("missing or live signals do not throw", () => {
  assert.doesNotThrow(() => throwIfAborted(undefined, "fallback"));
  assert.doesNotThrow(() => throwIfAborted(new AbortController().signal, "fallback"));
});

test("abortGuard binds a module's fallback message", () => {
  const throwIfRebuildAborted = abortGuard("static rebuild aborted");
  assert.doesNotThrow(() => throwIfRebuildAborted(undefined));
  assert.throws(() => throwIfRebuildAborted({ aborted: true, reason: undefined }), {
    message: "static rebuild aborted",
  });
});
