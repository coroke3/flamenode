import assert from "node:assert/strict";
import { test } from "node:test";
import { runEventWriteBehindVisibilityFence } from "../src/visibility/eventPrecommitGuard.ts";

function fixture({ readError = null, verifyError = null, initialManifest = null } = {}) {
  const calls = [];
  let current = initialManifest ?? { schema_version: 1, revision: 0, generated_at: 0, entities: [] };
  let etag = initialManifest ? "etag-existing" : null;
  let reads = 0;
  const visibilityHost = {
    manifest: {
      async read() {
        reads += 1;
        calls.push("r2.read");
        if (readError) throw readError;
        if (verifyError && reads > 1) throw verifyError;
        return { manifest: current, etag };
      },
      async write(next, options) {
        calls.push("r2.write");
        assert.ok(Object.hasOwn(options, "ifMatchEtag"));
        assert.equal(options.ifMatchEtag, etag);
        current = next;
        etag = "etag" + reads;
      },
    },
  };
  return { visibilityHost, calls, get manifest() { return current; } };
}

test("MIG-0652 U02 precommit T01: null fence token bypasses R2 without bypassing the commit", async () => {
  const f = fixture();
  let compensations = 0;
  const result = await runEventWriteBehindVisibilityFence({
    eventId: "e1", fenceToken: null, visibilityHost: f.visibilityHost,
    commit: async () => { f.calls.push("d1.commit"); return "committed"; },
    compensateOnFailure: async () => { compensations++; },
  });
  assert.equal(result, "committed");
  assert.deepEqual(f.calls, ["d1.commit"]);
  assert.equal(compensations, 0);
});

test("MIG-0652 U02 precommit T02: R2 must block event and verify token before D1 batch", async () => {
  const f = fixture();
  let compensations = 0;
  const result = await runEventWriteBehindVisibilityFence({
    eventId: "e2", fenceToken: "vf2", reason: "event_private",
    visibilityHost: f.visibilityHost,
    commit: async () => {
      f.calls.push("d1.commit");
      assert.equal(f.manifest.entities.length, 1);
      assert.equal(f.manifest.entities[0].fence_token, "vf2");
      assert.equal(f.manifest.entities[0].entity_type, "event");
      return { ok: true };
    },
    compensateOnFailure: async () => { compensations++; },
  });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(f.calls, ["r2.read", "r2.write", "r2.read", "d1.commit"]);
  assert.equal(compensations, 0);
});

test("MIG-0652 U02 precommit T03: failed R2 read never starts D1 and invokes compensation", async () => {
  const problem = new Error("r2 unavailable secret");
  const f = fixture({ readError: problem });
  let compensations = 0;
  await assert.rejects(
    runEventWriteBehindVisibilityFence({
      eventId: "e3", fenceToken: "vf3", visibilityHost: f.visibilityHost,
      commit: async () => { f.calls.push("d1.commit"); },
      compensateOnFailure: async () => { compensations++; f.calls.push("compensate"); },
    }),
    (error) => error === problem,
  );
  assert.deepEqual(f.calls, ["r2.read", "compensate"]);
  assert.equal(compensations, 1);
});

test("MIG-0652 U02 precommit T04: verification read failure compensates without committing", async () => {
  const problem = new Error("R2 verification unavailable");
  const f = fixture({ verifyError: problem });
  await assert.rejects(
    runEventWriteBehindVisibilityFence({
      eventId: "e4", fenceToken: "vf4", visibilityHost: f.visibilityHost,
      commit: async () => { f.calls.push("d1.commit"); },
      compensateOnFailure: async () => { f.calls.push("compensate"); },
    }),
    (error) => error === problem,
  );
  assert.deepEqual(f.calls, ["r2.read", "r2.write", "r2.read", "compensate"]);
});

test("MIG-0652 U02 precommit T05: D1 batch failure compensates after confirmed R2 block", async () => {
  const problem = new Error("D1 transaction failed");
  const f = fixture();
  await assert.rejects(
    runEventWriteBehindVisibilityFence({
      eventId: "e5", fenceToken: "vf5", visibilityHost: f.visibilityHost,
      commit: async () => {
        f.calls.push("d1.commit");
        assert.equal(f.manifest.entities[0].entity_id, "e5");
        throw problem;
      },
      compensateOnFailure: async () => { f.calls.push("compensate"); },
    }),
    (error) => error === problem,
  );
  assert.deepEqual(f.calls, ["r2.read", "r2.write", "r2.read", "d1.commit", "compensate"]);
});

test("MIG-0652 U02 precommit T06: failed compensation and warning sink preserve precommit and D1 errors", async () => {
  const precommitError = new Error("R2 precommit conflict");
  const d1Error = new Error("D1 conflict");
  const rollback = new Error("secret_token_from_R2");
  const warningError = new Error("secret diagnostic sink");
  const warnings = [];
  const priorWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.join(" "));
    throw warningError;
  };
  try {
    const precommit = fixture({ readError: precommitError });
    let precommitCompensations = 0;
    await assert.rejects(
      runEventWriteBehindVisibilityFence({
        eventId: "e6-precommit", fenceToken: "vf6-precommit",
        visibilityHost: precommit.visibilityHost,
        commit: async () => { precommit.calls.push("d1.commit"); },
        compensateOnFailure: async () => {
          precommitCompensations++;
          precommit.calls.push("compensate");
          throw rollback;
        },
      }),
      (error) => error === precommitError,
    );
    assert.equal(precommitCompensations, 1);
    assert.deepEqual(precommit.calls, ["r2.read", "compensate"],
      "failed precommit read must not write R2 or start D1");

    const d1 = fixture();
    let d1Compensations = 0;
    await assert.rejects(
      runEventWriteBehindVisibilityFence({
        eventId: "e6-d1", fenceToken: "vf6-d1",
        visibilityHost: d1.visibilityHost,
        commit: async () => {
          d1.calls.push("d1.commit");
          throw d1Error;
        },
        compensateOnFailure: async () => {
          d1Compensations++;
          d1.calls.push("compensate");
          throw rollback;
        },
      }),
      (error) => error === d1Error,
    );
    assert.equal(d1Compensations, 1);
    assert.deepEqual(d1.calls, [
      "r2.read", "r2.write", "r2.read", "d1.commit", "compensate",
    ], "the failed diagnostic must not trigger extra R2 writes or a second compensation");
  } finally {
    console.warn = priorWarn;
  }
  assert.deepEqual(warnings, ["[MIG-0652] event visibility compensation failed", "[MIG-0652] event visibility compensation failed"]);
  assert.ok(warnings.every(message => !message.includes("secret_token_from_R2")));
  assert.ok(warnings.every(message => !message.includes("secret diagnostic sink")));
});

test("MIG-0652 U02 precommit T07: no-token D1 failure does not compensate a nonexistent fence", async () => {
  const f = fixture();
  let compensations = 0;
  await assert.rejects(
    runEventWriteBehindVisibilityFence({
      eventId: "e7", fenceToken: null, visibilityHost: f.visibilityHost,
      commit: async () => { throw new Error("no-fence write failed"); },
      compensateOnFailure: async () => { compensations++; },
    }),
    /no-fence write failed/,
  );
  assert.deepEqual(f.calls, []);
  assert.equal(compensations, 0);
});

test("MIG-0652 U02 precommit T08: prior same-target fence token is immutable under competing archive", async () => {
  const original = {
    entity_type: "event", entity_id: "same-event",
    fence_token: "vf-first-writer", blocked_at: 1000, reason: "inflight_first_archive",
  };
  const f = fixture({
    initialManifest: { schema_version: 1, revision: 7, generated_at: 1000, entities: [original] },
  });
  let commits = 0;
  await assert.rejects(
    runEventWriteBehindVisibilityFence({
      eventId: "same-event",
      fenceToken: "vf-second-writer",
      reason: "event_private",
      visibilityHost: f.visibilityHost,
      commit: async () => { commits++; },
      compensateOnFailure: async () => { f.calls.push("compensate"); },
    }),
    /public_visibility_fence_token_mismatch/,
  );
  assert.equal(commits, 0, "the second operation cannot reach D1");
  assert.deepEqual(f.calls, ["r2.read", "compensate"]);
  assert.equal(f.manifest.revision, 7);
  assert.deepEqual(f.manifest.entities, [original]);
});

