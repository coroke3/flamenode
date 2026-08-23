import assert from "node:assert/strict";
import { test } from "node:test";
import {
  notificationFallbackLimitForD1Budget,
  runFastJobs,
} from "./index.ts";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
const sharedSource = await readFile(
  new URL("../shared/createCronWorker.ts", import.meta.url),
  "utf8",
);

test("fast-jobs health は共通Cron Workerからserviceとcommitを返す", () => {
  assert.match(source, /createCronWorker/);
  assert.match(source, /service:\s*"flamenode-fast-jobs"/);
  assert.match(source, /BUILD_COMMIT_SHA/);
  assert.match(sharedSource, /pathname\s*===\s*[\r\n\s]*"\/health"/);
  assert.match(sharedSource, /commit:/);
  assert.match(sharedSource, /env\.BUILD_COMMIT_SHA/);
});

test("outer leaseのAbortSignalをnotification dispatcherへ渡す", () => {
  assert.match(
    source,
    /processNotificationQueue\(budgetEnv,\s*\{[\s\S]*?limit:\s*fallbackLimit,[\s\S]*?signal,[\s\S]*?\}\)/,
  );
  assert.match(source, /if \(isAbortError\(error\)\) notificationAbortError = error/);
  assert.match(source, /if \(notificationAbortError\) throw notificationAbortError/);
});

test("Queue wake成功時はCronでDiscord dispatchを二重実行しない", () => {
  const dueIndex = source.indexOf("if (!(await hasDuePendingNotifications(budgetEnv, signal)))");
  const wakeIndex = source.indexOf("const delegatedToQueue =", dueIndex);
  const dispatchIndex = source.indexOf("processNotificationQueue(budgetEnv", dueIndex);
  assert.ok(dueIndex >= 0 && wakeIndex > dueIndex && dispatchIndex > wakeIndex);
  assert.match(source, /if \(delegatedToQueue\) \{[\s\S]*?skipped: 1/);
  assert.match(source, /sentKinds: wakeSentKinds/);
  assert.doesNotMatch(source, /Queue consumerは大幅に長いCPU枠/);
});

test("Cron fallbackは外部送信後のD1完了処理と残件probeまで収まる件数へ縮める", () => {
  assert.equal(notificationFallbackLimitForD1Budget(0), 6);
  assert.equal(notificationFallbackLimitForD1Budget(14), 5);
  assert.equal(notificationFallbackLimitForD1Budget(15), 5);
  assert.equal(notificationFallbackLimitForD1Budget(39), 0);
  assert.equal(notificationFallbackLimitForD1Budget(40), 0);
  assert.equal(notificationFallbackLimitForD1Budget(49), 0);
  assert.match(source, /NOTIFICATION_FALLBACK_MAX_D1_STATEMENTS_PER_ROW = 5/);
  assert.match(source, /NOTIFICATION_FALLBACK_POST_DRAIN_PROBE_D1_STATEMENTS = 1/);
  assert.match(source, /FAST_JOBS_OUTER_LEASE_D1_RESERVE = 4/);
  assert.match(source, /if \(fallbackLimit <= 0\)/);
});

test("Queue無効時はdirect drain後の残件SELECTを実行しない", () => {
  const helper = source.slice(
    source.indexOf("async function maybeResendNotificationWake"),
    source.indexOf("export async function runNotificationRecovery"),
  );
  const flagIndex = helper.indexOf("if (!flags.dispatchEnabled) return");
  const probeIndex = helper.indexOf("hasDuePendingNotifications(env)");
  assert.ok(flagIndex >= 0);
  assert.ok(probeIndex > flagIndex);
});

test("reminder失敗後もQueue無効ならnotification dispatchを実行し最後に集約失敗する", async () => {
  let notificationSelectionRan = false;
  const env = {
    NEXT_PUBLIC_SITE_URL: "https://flamenode.example",
    KV: {
      async get() {
        return null;
      },
      async put() {},
      async delete() {},
    },
    DB: {
      prepare(sql) {
        return {
          bind() {
            return this;
          },
          async run() {
            return { meta: { changes: 1 } };
          },
          async all() {
            if (sql.includes("FROM slots s")) {
              throw new Error("no such table: reminder_failure_fixture");
            }
            if (sql.includes("FROM notification_outbox n")) {
              if (sql.includes("LIMIT 1") && !sql.includes("INNER JOIN")) {
                return { results: [{ id: "pending-1" }] };
              }
              notificationSelectionRan = true;
            }
            return { results: [] };
          },
        };
      },
    },
  };

  await assert.rejects(
    runFastJobs(env, {
      scheduledTime: Date.now(),
      signal: new AbortController().signal,
    }),
    /reported 1 failed operation/,
  );
  assert.equal(notificationSelectionRan, true);
});

test("recovery: Queue無しでも due pending を処理できる", async () => {
  let dispatchRan = false;
  const env = {
    NEXT_PUBLIC_SITE_URL: "https://flamenode.example",
    KV: {
      async get() {
        return null;
      },
      async put() {},
      async delete() {},
    },
    DB: {
      prepare(sql) {
        return {
          bind() {
            return this;
          },
          async run() {
            return { meta: { changes: 1 } };
          },
          async all() {
            if (sql.includes("FROM slots s")) {
              return { results: [] };
            }
            if (sql.includes("FROM notification_outbox n")) {
              if (sql.includes("LIMIT 1") && !sql.includes("INNER JOIN")) {
                return { results: [{ id: "pending-1" }] };
              }
              dispatchRan = true;
            }
            return { results: [] };
          },
        };
      },
    },
  };

  await runFastJobs(env, {
    scheduledTime: Date.now(),
    signal: new AbortController().signal,
  });
  assert.equal(dispatchRan, true);
});

test("recovery: Queue有効でwake成功ならdirect dispatchを省略する", async () => {
  let dispatchRan = false;
  let queueSends = 0;
  const env = {
    NEXT_PUBLIC_SITE_URL: "https://flamenode.example",
    QUEUE_DISPATCH_ENABLED: "1",
    QUEUE_CONTINUATION_ENABLED: "1",
    NOTIFICATION_WAKE_QUEUE: {
      async send() {
        queueSends += 1;
      },
    },
    KV: {
      async get() {
        return null;
      },
      async put() {},
      async delete() {},
    },
    DB: {
      prepare(sql) {
        return {
          bind() {
            return this;
          },
          async run() {
            return { meta: { changes: 1 } };
          },
          async all() {
            if (sql.includes("FROM slots s")) return { results: [] };
            if (sql.includes("FROM notification_outbox n")) {
              if (sql.includes("LIMIT 1") && !sql.includes("INNER JOIN")) {
                return { results: [{ id: "pending-1" }] };
              }
              dispatchRan = true;
            }
            return { results: [] };
          },
        };
      },
    },
  };

  await runFastJobs(env, {
    scheduledTime: Date.now(),
    signal: new AbortController().signal,
  });
  assert.equal(queueSends, 1);
  assert.equal(dispatchRan, false);
});