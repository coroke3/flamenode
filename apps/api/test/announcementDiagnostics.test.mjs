// SEC-827: announcements must retain fixed CURRENT/Hono failure semantics
// when provider errors or diagnostic sinks are hostile.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { logAnnouncementFailure } from "../src/routes/admin/announcements.ts";

const FIXED_LOG = "[announcement] atomic mutation failed";
const FIXED_RESULT = "保存に失敗しました。再読み込みして、もう一度お試しください。";

test("SEC-827 Hono diagnostic emits only one fixed code and never throws", () => {
  const original = console.error;
  const calls = [];
  try {
    for (const throws of [false, true]) {
      console.error = (...args) => {
        calls.push(args);
        if (throws) throw new Error("SEC827_BROKEN_LOG_SINK");
      };
      assert.doesNotThrow(() => logAnnouncementFailure());
    }
  } finally {
    console.error = original;
  }
  assert.deepEqual(calls, [[FIXED_LOG], [FIXED_LOG]]);
});

test("SEC-827 all five Hono create/update/delete read and write errors use the safe diagnostic", async () => {
  const source = await readFile(new URL("../src/routes/admin/announcements.ts", import.meta.url), "utf8");
  const sites = [...source.matchAll(/catch \{\s*logAnnouncementFailure\(\);\s*return failure\(c, 500, ANNOUNCEMENT_FAILURE_MESSAGE\);\s*\}/g)];
  assert.equal(sites.length, 5, "all Hono announcement DB failure branches should preserve the fixed 500 response");
  assert.doesNotMatch(source, /console\.error\([^;]*,\s*error\)/);
  assert.match(source, /function failure\([\s\S]*?return c\.json\(body, status\)/);
});

test("SEC-827 real CURRENT action failure helper preserves control-flow throw and fixed DTO", async () => {
  const source = await readFile(new URL("../../../src/lib/actions/announcement.ts", import.meta.url), "utf8");
  const matched = source.match(/function announcementMutationError\(error: unknown\): AnnouncementResult \{[\s\S]*?\n\}/);
  assert.ok(matched, "must use actual CURRENT exported-action error helper source");
  const executable = matched[0].replace("(error: unknown): AnnouncementResult", "(error)");
  assert.match(executable, /unstable_rethrow\(error\);/);
  assert.doesNotMatch(executable, /console\.error\([^;]*,\s*error\)/);
  for (const throws of [false, true]) {
    const logs = [];
    const controlFlow = new Error("SEC827_NEXT_REDIRECT");
    const fn = runInNewContext(`(${executable})`, {
      unstable_rethrow: (error) => {
        if (error === controlFlow) throw error;
      },
      console: {
        error: (...args) => {
          logs.push(args);
          if (throws) throw new Error("SEC827_BROKEN_LOG_SINK");
        },
      },
    });
    const poisoned = new Proxy(new Error("SQL params: SECRET_PROVIDER_TOKEN"), {
      get() { throw new Error("SEC827_UNSAFE_GETTER"); },
      getPrototypeOf() { throw new Error("SEC827_UNSAFE_PROTO"); },
    });
    const result = fn(poisoned);
    assert.equal(result.ok, false);
    assert.equal(result.message, FIXED_RESULT);
    assert.deepEqual(logs, [[FIXED_LOG]]);
    assert.throws(() => fn(controlFlow), (error) => error === controlFlow);
  }
});
