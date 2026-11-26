import test from "node:test";
import assert from "node:assert/strict";
import { runPostCommitBestEffort } from "@flamenode/server-core/audit/postCommit";

async function withCapturedPostCommitLogs(run) {
  const originalWarn = console.warn;
  const originalInfo = console.info;
  const logs = [];
  console.warn = (...args) => logs.push({ stream: "warn", args });
  console.info = (...args) => logs.push({ stream: "info", args });
  try {
    return { value: await run(), logs };
  } finally {
    console.warn = originalWarn;
    console.info = originalInfo;
  }
}

test("SEC-745: arbitrary provider Error.name/message/cause cannot leak to postcommit logs", async () => {
  const secret = "SEC745_PROVIDER_CREDENTIAL_CANARY";
  const err = Object.assign(
    new Error("message:" + secret, { cause: new Error("cause:" + secret) }),
    { name: secret },
  );
  const completed = [];
  const { value, logs } = await withCapturedPostCommitLogs(() =>
    runPostCommitBestEffort({ flow: "slot_video", traceId: "ft_sec745_1" }, [
      { name: "youtube_sync_wake", run: async () => { throw err; } },
      { name: "revalidate", run: async () => { completed.push("revalidate"); } },
      { name: "icon_orphan_cleanup", run: async () => { completed.push("icon_orphan_cleanup"); } },
    ]),
  );
  assert.deepEqual(completed, ["revalidate", "icon_orphan_cleanup"]);
  assert.deepEqual(value, [{ name: "youtube_sync_wake", error_code: "Error", retryable: false }]);
  const warnings = logs.filter((x) => x.stream === "warn").map((x) => JSON.parse(x.args[0]));
  assert.deepEqual(warnings, [{
    service: "post_commit", flow: "slot_video", trace_id: "ft_sec745_1",
    task: "youtube_sync_wake", error_code: "Error", retryable: false,
  }]);
  assert.ok(logs.some((x) => x.stream === "info" && JSON.parse(x.args[0]).result === "failed"));
  assert.ok(!JSON.stringify({ logs, value }).includes(secret),
    "all warning and flow-trace payloads must exclude provider details");
});

test("SEC-745: throwing Error.name getter is read once, never interrupts committed work", async () => {
  const secret = "SEC745_THROWING_NAME_ACCESSOR";
  const err = new Error(secret);
  let reads = 0;
  Object.defineProperty(err, "name", {
    get() { reads++; throw new Error("getter:" + secret); },
  });
  const ran = [];
  const { value, logs } = await withCapturedPostCommitLogs(() =>
    runPostCommitBestEffort({ flow: "post_commit", traceId: "ft_sec745_2" }, [
      { name: "failed_wake", run: async () => { throw err; } },
      { name: "safe_followup", run: async () => { ran.push("safe_followup"); } },
    ]),
  );
  assert.equal(reads, 1, "hostile accessor must not be read again for retryability");
  assert.deepEqual(ran, ["safe_followup"]);
  assert.deepEqual(value, [{ name: "failed_wake", error_code: "Error", retryable: false }]);
  assert.ok(!JSON.stringify({ logs, value }).includes(secret));
});

test("SEC-745: fixed TypeError/FetchError codes keep existing retry policy", async () => {
  const custom = new Error("fetch lost");
  custom.name = "FetchError";
  const { value, logs } = await withCapturedPostCommitLogs(() =>
    runPostCommitBestEffort({ flow: "test", traceId: "ft_sec745_3" }, [
      { name: "type", run: async () => { throw new TypeError("network"); } },
      { name: "fetch", run: async () => { throw custom; } },
      { name: "string", run: async () => { throw "provider-string"; } },
    ]),
  );
  assert.deepEqual(value, [
    { name: "type", error_code: "TypeError", retryable: true },
    { name: "fetch", error_code: "FetchError", retryable: true },
    { name: "string", error_code: "UnknownError", retryable: false },
  ]);
  assert.equal(logs.filter((x) => x.stream === "warn").length, 3);
  assert.ok(!JSON.stringify(logs).includes("provider-string"));
});

test("SEC-745: a broken warning sink never stops later postcommit tasks", async () => {
  const originalWarn = console.warn;
  const completed = [];
  console.warn = () => { throw new Error("logging unavailable"); };
  let value;
  try {
    value = await runPostCommitBestEffort({ flow: "test", traceId: "ft_sec745_4" }, [
      { name: "fails", run: async () => { throw new Error("provider unavailable"); } },
      { name: "continues", run: async () => { completed.push("continues"); } },
    ]);
  } finally {
    console.warn = originalWarn;
  }
  assert.deepEqual(value, [{ name: "fails", error_code: "Error", retryable: false }]);
  assert.deepEqual(completed, ["continues"]);
});

test("SEC-745: Proxy getPrototypeOf trap cannot turn diagnostic classification into a failure", async () => {
  const secret = "SEC745_PROXY_PROTOTYPE_SECRET";
  const err = new Proxy(new Error("provider:" + secret), {
    getPrototypeOf() { throw new Error("trap:" + secret); },
  });
  const completed = [];
  const { value, logs } = await withCapturedPostCommitLogs(() =>
    runPostCommitBestEffort({ flow: "test", traceId: "ft_sec745_5" }, [
      { name: "proxy", run: async () => { throw err; } },
      { name: "next", run: async () => { completed.push("next"); } },
    ]),
  );
  assert.deepEqual(value, [{ name: "proxy", error_code: "Error", retryable: false }]);
  assert.deepEqual(completed, ["next"]);
  assert.ok(!JSON.stringify({ logs, value }).includes(secret));
});
