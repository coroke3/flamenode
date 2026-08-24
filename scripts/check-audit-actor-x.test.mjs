import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("check:audit-actor-x recognizes the bulk strict actor X validation", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(root, "scripts", "check-audit-actor-x.mjs")],
    {
      cwd: root,
      encoding: "utf8",
    },
  );

  assert.equal(
    result.status,
    0,
    [result.stdout, result.stderr].filter(Boolean).join("\n"),
  );
  assert.match(result.stdout, /actor X audit wiring present/);
});
