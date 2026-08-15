import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./adminMembers.ts", import.meta.url), "utf8");

test("admin member save catches plan and queue preparation failures", () => {
  const planStart = source.indexOf("const plan = emptyVideoAtomicWritePlan()");
  const tryStart = source.lastIndexOf("try {", planStart);
  const executeStart = source.indexOf("executeVideoAtomicWritePlan", planStart);
  const catchStart = source.indexOf("} catch (error) {", executeStart);

  assert.ok(planStart >= 0);
  assert.ok(tryStart >= 0 && tryStart < planStart);
  assert.ok(executeStart > planStart);
  assert.ok(catchStart > executeStart);
  assert.match(source.slice(catchStart), /unstable_rethrow\(error\)/);
  assert.match(source.slice(catchStart), /ok: false/);
});
