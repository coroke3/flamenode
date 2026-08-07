import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./createFreeVideo.ts", import.meta.url), "utf8");

test("createFreeVideo は writeGuard 通過後・解析/R2前に active_x_snapshot を検証する", () => {
  const fnStart = source.indexOf("export async function createFreeVideo");
  const fnBody = source.slice(fnStart);
  const activeXCheck = fnBody.indexOf("guard.approvedXIds.includes(activeX)");
  const snapshotCheck = fnBody.indexOf("validateActiveXSnapshot");
  const parseForm = fnBody.indexOf("parseVideoForm");
  const iconResolve = fnBody.indexOf("resolveVideoCreatorIcon");

  assert.ok(activeXCheck >= 0);
  assert.ok(snapshotCheck > activeXCheck);
  assert.ok(parseForm > snapshotCheck);
  assert.ok(iconResolve > snapshotCheck);
  assert.match(fnBody, /active_x_snapshot/);
});
