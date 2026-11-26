import assert from "node:assert/strict";
import { test } from "node:test";
import {
  previewLegacyImport, applyLegacyImportStep,
} from "../.test-dist/apps/ops/src/api/adminLegacyImport.js";

const now = 1_800_000_000;
const file = new File(["id,title\n1,Example"], "legacy.csv", { type: "text/csv" });
const preview = {
  ok: true, mode: "preview", preview_token: "opaque-token",
  plan_hash: "opaque-plan-hash", expires_at: now + 3600,
  warnings: [], file_ranges: [{ fileName: "legacy.csv", sourceRows: 1,
    startRow: 1, endRow: 1, selectedRows: 1 }],
};
const credential = { token: preview.preview_token, planHash: preview.plan_hash,
  expiresAt: preview.expires_at };
const result = { ok: true, mode: "apply", continuation_required: true,
  progress: { stage: "events", index: 1, completed: 1, total: 2 } };
const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
// CURRENT route: D1 step committed, then claimed.advance(progress) failed in R2.
const committedPending = {
  ok: false, committed: true, kind: "committed_progress_pending",
  retryable: true, requires_repreview: false, plan_hash: credential.planHash, attempt: 1,
  progress: { stage: "videos", index: 1, completed: 6, total: 7 },
  result: { complete: false, created: { videos: 1 } },
};

test("MIG-0737 U02: preview POST multipart matches CURRENT, excludes old token", async () => {
  const options = new FormData();
  options.set("overwrite_existing", "yes");
  options.set("mode", "apply");
  options.set("preview_token", "stale-token");
  options.set("plan_hash", "stale-hash");
  options.set("files", "forged");
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push([url, init]);
    return json(200, preview);
  };
  const out = await previewLegacyImport(fetchFn, options, [file], [
    { source_key: "legacy", action: "custom_question", question_label: "質問文Q" },
  ], undefined, now);
  assert.equal(out.status, "ok");
  assert.equal(calls.length, 1);
  const [url, init] = calls[0];
  assert.equal(url, "/api/admin/import/legacy");
  assert.equal(init.method, "POST");
  assert.equal(init.credentials, "same-origin");
  assert.equal(init.cache, "no-store");
  assert.equal(init.headers, undefined, "multipart boundary is set by browser");
  assert.equal(init.body.get("mode"), "preview");
  assert.equal(init.body.get("overwrite_existing"), "yes");
  assert.equal(init.body.get("preview_token"), null);
  assert.equal(init.body.get("plan_hash"), null);
  assert.equal(init.body.getAll("files").length, 1);
  assert.equal(init.body.get("files").name, "legacy.csv");
  assert.deepEqual(JSON.parse(init.body.get("video_custom_field_decisions")),
    [{ source_key: "legacy", action: "custom_question", question_label: "質問文Q" }]);
});

test("MIG-0737 U02: apply contains ONLY preview token + plan hash; no files/choices", async () => {
  let call = null;
  const fetchFn = async (path, init) => {
    call = [path, init];
    return json(200, result);
  };
  const out = await applyLegacyImportStep(fetchFn, credential, now);
  assert.equal(out.status, "ok");
  assert.deepEqual(out.data.progress, result.progress);
  assert.equal(call[0], "/api/admin/import/legacy");
  assert.equal(call[1].method, "POST");
  assert.deepEqual([...call[1].body.entries()], [
    ["mode", "apply"], ["preview_token", "opaque-token"], ["plan_hash", "opaque-plan-hash"],
  ]);
});

test("MIG-0737 U02: no preview request on empty files/unsafe mapping question", async () => {
  let calls = 0;
  const fn = async () => { calls++; return json(200, preview); };
  assert.deepEqual(await previewLegacyImport(fn, new FormData(), [], [], undefined, now),
    { status: "unavailable" });
  assert.deepEqual(await previewLegacyImport(fn, new FormData(), [file],
    [{ source_key: "", action: "ignore" }], undefined, now), { status: "unavailable" });
  assert.deepEqual(await previewLegacyImport(fn, new FormData(), [file],
    [{ source_key: "legacy", action: "custom_question", question_label: "" }],
    undefined, now), { status: "unavailable" });
  assert.deepEqual(await previewLegacyImport(fn, new FormData(), [file],
    [{ source_key: "legacy", action: "custom_question", question_label: "X".repeat(121) }],
    undefined, now), { status: "unavailable" });
  assert.equal(calls, 0);
});

test("MIG-0737 U02: expired, missing and invalid credential cannot submit apply", async () => {
  let calls = 0;
  const fn = async () => { calls++; return json(200, result); };
  for (const c of [
    { ...credential, expiresAt: now },
    { ...credential, expiresAt: now - 1 },
    { ...credential, expiresAt: Number.NaN },
    { ...credential, token: "" },
    { ...credential, planHash: "" },
  ]) assert.deepEqual(await applyLegacyImportStep(fn, c, now), { status: "unavailable" });
  assert.equal(calls, 0);
});

test("MIG-0737 U02: malformed server preview or expired token is rejected", async () => {
  for (const wrong of [
    { ...preview, preview_token: "" },
    { ...preview, plan_hash: "" },
    { ...preview, expires_at: now },
    { ...preview, expires_at: "tomorrow" },
    { ...preview, ok: false },
    { ...preview, file_ranges: [{ fileName: "legacy.csv", sourceRows: -1,
      startRow: 1, endRow: 1, selectedRows: 1 }] },
  ]) assert.equal((await previewLegacyImport(async () => json(200, wrong),
    new FormData(), [file], [], undefined, now)).status, "unavailable");
});

test("MIG-0737 U02: non-2xx/auth failures never treated as successful preview or apply", async () => {
  const cases = [[401, "anonymous"], [403, "forbidden"], [404, "notFound"],
    [409, "unavailable"], [423, "unavailable"], [501, "unsupported"], [503, "unavailable"]];
  for (const [code, status] of cases) {
    const fn = async () => json(code, { ok: true, ...preview });
    assert.equal((await previewLegacyImport(fn, new FormData(), [file], [], undefined, now)).status, status);
    assert.equal((await applyLegacyImportStep(fn, credential, now)).status, status);
  }
});

test("MIG-0737 U02: abort blocks network and late success, without retry", async () => {
  const aborted = new AbortController(); aborted.abort();
  let calls = 0;
  const fn = async () => { calls++; return json(200, preview); };
  assert.deepEqual(await previewLegacyImport(fn, new FormData(), [file],
    [], aborted.signal, now), { status: "unavailable" });
  assert.deepEqual(await applyLegacyImportStep(fn, credential, now, aborted.signal),
    { status: "unavailable" });
  assert.equal(calls, 0);
  const controller = new AbortController();
  const late = async () => { calls++; controller.abort(); return json(200, result); };
  assert.equal((await applyLegacyImportStep(late, credential, now, controller.signal)).status, "unavailable");
  assert.equal(calls, 1);
});

test("MIG-0737 U02: apply fails closed on non-atomic response and never retries unknown commit", async () => {
  let calls = 0;
  const fn = async () => { calls++; throw new Error("connection lost after commit"); };
  assert.deepEqual(await applyLegacyImportStep(fn, credential, now), { status: "unavailable" });
  assert.equal(calls, 1);
  for (const body of [
    { ...result, ok: "true" }, { ...result, progress: { stage: "events", completed: "1", index: 1, total: 2 } },
    { ...result, continuation_required: "false" },
  ]) assert.deepEqual(await applyLegacyImportStep(async () => json(200, body), credential, now),
    { status: "unavailable" });
});

test("MIG-0737 U02: 409/503 preserves confirmed progress without reflecting private recovery data", async () => {
  for (const code of [409, 503]) {
    let requests = 0;
    const out = await applyLegacyImportStep(async () => {
      requests++;
      return json(code, { ...committedPending,
        message: "private-provider-canary", error: { sql: "private-provider-canary" },
        result: { ...committedPending.result, private: "private-provider-canary" },
      });
    }, credential, now);
    assert.deepEqual(out, { status: "committedProgressPending", progress: committedPending.progress });
    assert.equal(requests, 1, "progress recovery never retries the committed D1 step");
    assert.doesNotMatch(JSON.stringify(out), /private-provider-canary|opaque-plan-hash|opaque-token/);
  }
});

test("MIG-0737 U02: last committed D1 step still requires progress recovery", async () => {
  const progress = { stage: "complete", index: 0, completed: 7, total: 7 };
  const out = await applyLegacyImportStep(async () => json(503, {
    ...committedPending, progress, result: { complete: true },
  }), credential, now);
  assert.deepEqual(out, { status: "committedProgressPending", progress });
});

test("MIG-0737 U02: recovery markers never override HTTP/auth boundaries or turn preview into apply", async () => {
  for (const [code, status] of [[200, "unavailable"], [400, "unavailable"],
    [401, "anonymous"], [403, "forbidden"], [404, "notFound"], [423, "unavailable"],
    [500, "unavailable"], [501, "unsupported"]]) {
    assert.deepEqual(await applyLegacyImportStep(async () => json(code, committedPending), credential, now),
      { status });
  }
  for (const code of [409, 503]) {
    assert.deepEqual(await previewLegacyImport(async () => json(code, committedPending),
      new FormData(), [file], [], undefined, now), { status: "unavailable" });
  }
});

test("MIG-0737 U02: incomplete, mismatched or impossible recovery DTOs fail closed", async () => {
  const wrong = [
    { ok: true }, { committed: "true" }, { committed: false }, { committed: undefined },
    { kind: "unknown" }, { kind: undefined }, { retryable: "true" }, { retryable: false },
    { requires_repreview: true }, { requires_repreview: undefined },
    { plan_hash: "another-plan" }, { plan_hash: undefined },
    { attempt: 0 }, { attempt: 1.5 }, { attempt: Number.MAX_SAFE_INTEGER + 1 },
    { progress: undefined }, { result: undefined }, { result: { complete: "false" } },
    { result: { complete: true } },
    ...[
      { stage: "private-provider-canary" }, { index: -1 }, { index: "1" },
      { index: 7 }, { completed: 1.5 }, { completed: "6" }, { completed: 8 },
      { total: 0 }, { total: -1 }, { total: Number.MAX_SAFE_INTEGER + 1 },
      { stage: "complete", index: 0, completed: 6, total: 7 },
    ].map(progress => ({ progress: { ...committedPending.progress, ...progress } })),
    { progress: { stage: "complete", index: 1, completed: 7, total: 7 }, result: { complete: true } },
  ];
  for (const patch of wrong) {
    for (const code of [409, 503]) {
      assert.deepEqual(await applyLegacyImportStep(async () => json(code, {
        ...committedPending, ...patch,
      }), credential, now), { status: "unavailable" }, JSON.stringify({ code, patch }));
    }
  }
});

test("MIG-0737 U02: recovery body is byte-bounded before parsing, including chunked UTF-8", async () => {
  const encoder = new TextEncoder();
  const prefix = JSON.stringify(committedPending);
  const atLimit = prefix + " ".repeat(64 * 1024 - encoder.encode(prefix).byteLength);
  assert.deepEqual(await applyLegacyImportStep(async () => new Response(atLimit, { status: 409 }),
    credential, now), { status: "committedProgressPending", progress: committedPending.progress });

  for (const [code, padding, headers] of [[409, " ".repeat(64 * 1024), {}],
    [503, "あ".repeat(24_000), { "content-length": "1" }]]) {
    let cancelled = false;
    const chunks = [encoder.encode(prefix), encoder.encode(padding)];
    const stream = new ReadableStream({
      pull(controller) {
        if (chunks.length) controller.enqueue(chunks.shift());
      },
      cancel() { cancelled = true; },
    });
    const out = await applyLegacyImportStep(async () => new Response(stream, { status: code, headers }),
      credential, now);
    assert.deepEqual(out, { status: "unavailable" });
    assert.equal(cancelled, true, "oversized body is cancelled without draining the response");
  }
});

test("MIG-0737 U02: malformed or cancelled recovery body cannot assert a commit", async () => {
  for (const body of ["{bad json", new Uint8Array([0xff]), null]) {
    assert.deepEqual(await applyLegacyImportStep(async () => new Response(body, { status: 503 }),
      credential, now), { status: "unavailable" });
  }
  const controller = new AbortController();
  let cancelled = false;
  const stream = new ReadableStream({ cancel() { cancelled = true; } });
  const pending = applyLegacyImportStep(async () => new Response(stream, { status: 409 }),
    credential, now, controller.signal);
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  assert.deepEqual(await pending, { status: "unavailable" });
  assert.equal(cancelled, true);
});
