import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./enqueue.ts", import.meta.url), "utf8");

test("通常 enqueue は active row の CAS 失敗を最大1回だけ再試行する", () => {
  assert.match(source, /for \(let enqueueAttempt = 0; enqueueAttempt < 2;/);
  assert.match(source, /result\.meta\?\.changes/);
  assert.match(source, /static rebuild queue active row changed during enqueue/);
  assert.match(source, /eq\(staticRebuildQueue\.updated_at, row\.updated_at\)/g);
});
