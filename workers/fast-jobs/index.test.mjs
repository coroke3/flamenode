import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runFastJobs } from "./index.ts";

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
    /processNotificationQueue\(env,\s*\{[\s\S]*?limit:\s*MAX_NOTIFICATION_BATCH,[\s\S]*?signal,[\s\S]*?\}\)/,
  );
  assert.match(source, /if \(isAbortError\(error\)\) notificationAbortError = error/);
  assert.match(source, /if \(notificationAbortError\) throw notificationAbortError/);
});

test("reminder失敗後もnotification dispatchを実行し最後に集約失敗する", async () => {
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
