import test from "node:test";
import assert from "node:assert/strict";
import { handleVideoVisibilityMutationFailure } from "@flamenode/server-core/visibility/videoTransition";

// MIG-0615: framework control-flow errors (Next redirect / notFound) are handed to the injected
// RethrowFrameworkControl before anything else; a no-op port (Hono) lets the failure be reported.
const input = {
  flow: "admin_video_status",
  traceId: "trace-rethrow",
  videoId: "vid-1",
  depublicizedFromPublic: false,
  fenceToken: null,
};
const manifest = {
  read: async () => {
    throw new Error("manifest must not be read without a fence token");
  },
  write: async () => {
    throw new Error("manifest must not be written without a fence token");
  },
};

function silenceConsole() {
  const originals = { info: console.info, warn: console.warn };
  const rows = [];
  console.info = (...args) => rows.push(["info", ...args]);
  console.warn = (...args) => rows.push(["warn", ...args]);
  return {
    rows,
    restore: () => Object.assign(console, originals),
  };
}

test("a framework control error is rethrown before logging or compensating", async () => {
  const control = new Error("NEXT_REDIRECT");
  const seen = [];
  const sink = silenceConsole();
  try {
    await assert.rejects(
      handleVideoVisibilityMutationFailure({}, control, { ...input, fenceToken: "vf_tok" }, {
        manifest,
        rethrowFrameworkControl: (error) => {
          seen.push(error);
          throw error;
        },
      }),
      (error) => error === control,
    );
  } finally {
    sink.restore();
  }
  assert.deepEqual(seen, [control]);
  assert.deepEqual(sink.rows, []);
});

test("a no-op port reports the failure with the fixed message", async () => {
  const sink = silenceConsole();
  try {
    const result = await handleVideoVisibilityMutationFailure({}, new Error("d1 down"), input, {
      manifest,
      rethrowFrameworkControl: () => {},
    });
    assert.equal(result.ok, false);
    assert.equal(result.message, "更新が競合したか、監査記録に失敗しました。再読み込みしてお試しください。");
  } finally {
    sink.restore();
  }
  assert.equal(sink.rows.length, 2);
});
