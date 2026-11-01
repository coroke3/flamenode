import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./check-static-rebuild-atomicity.mjs", import.meta.url));

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "flamenode-atomicity-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function put(relative, contents) {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
    return target;
  }

  for (const name of ["actions", "admin/spreadsheet", "video"]) {
    mkdirSync(path.join(root, "src/lib", name), { recursive: true });
  }
  put(
    "packages/server-core/src/staticRebuild/enqueue.ts",
    [
      "export async function buildStaticRebuildQueueBatch() {",
      "  const statement = \"FROM json_each(${payload}) ON CONFLICT(target_type, target_id) WHERE status IN (\'pending\', \'processing\')\";",
      "  return statement;",
      "}",
      "export async function enqueueStaticRebuild() {}",
    ].join("\n"),
  );
  put(
    "src/lib/publicData/loader.ts",
    'const directEnqueueStaticRebuild = true; const probePublicStaticTarget = true; enqueued = enqueueResult.action === "inserted";',
  );
  const run = () => spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
  return { root, put, run };
}

test("ordinary scan roots pass without unsafe source", (t) => {
  const { put, run } = fixture(t);
  put("src/lib/actions/clean.ts", "const visibility_status = 'public';");
  put("src/lib/actions/ignored.test.tsx", "visibility_status mutateWithAudit enqueueStaticRebuild(");
  const result = run();
  assert.equal(result.status, 0, result.stderr);
});

for (const extension of ["tsx", "mts"]) {
  test(`unsafe ${extension} action source cannot bypass the atomicity audit`, (t) => {
    const { put, run } = fixture(t);
    put(
      `src/lib/actions/unsafe.${extension}`,
      "const visibility_status = 'public'; mutateWithAudit(); enqueueStaticRebuild();",
    );
    const result = run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /mutateWithAudit.*enqueueStaticRebuild/);
  });
}

test("a symlinked source file is rejected rather than silently skipped", (t) => {
  const { root, put, run } = fixture(t);
  if (process.platform === "win32") return t.skip("symlink privileges vary on Windows");
  const external = put("outside.ts", "visibility_status mutateWithAudit enqueueStaticRebuild");
  symlinkSync(external, path.join(root, "src/lib/actions/alias.ts"));
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /symlink in scan tree/);
});

test("a symlinked nested directory is rejected", (t) => {
  const { root, run } = fixture(t);
  if (process.platform === "win32") return t.skip("symlink privileges vary on Windows");
  const external = path.join(root, "outside");
  mkdirSync(external);
  symlinkSync(external, path.join(root, "src/lib/actions/linked"), "dir");
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /symlink in scan tree/);
});

test("a symlinked scan-root ancestor is rejected", (t) => {
  const { root, run } = fixture(t);
  if (process.platform === "win32") return t.skip("symlink privileges vary on Windows");
  const source = path.join(root, "src/lib");
  const physical = path.join(root, "physical-lib");
  renameSync(source, physical);
  symlinkSync(physical, source, "dir");
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /symlink in scan path/);
});
