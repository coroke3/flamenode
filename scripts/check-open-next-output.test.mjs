import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  checkOpenNextOutput,
  writeBuildManifest,
} from "./check-open-next-output.mjs";

const COMMIT = "a".repeat(40);

function fixture(t) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "flamenode-open-next-"));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  const outputRoot = path.join(repoRoot, ".open-next");
  const assetsPath = path.join(outputRoot, "assets");
  const configPath = path.join(outputRoot, "server-functions", "default", "open-next.config.mjs");
  fs.mkdirSync(assetsPath, { recursive: true });
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(path.join(outputRoot, "worker.js"), "export default {};\n");
  fs.writeFileSync(path.join(assetsPath, "manifest.webmanifest"), "{}\n");
  fs.writeFileSync(path.join(assetsPath, "app.js"), "console.log('ok');\n");
  fs.writeFileSync(configPath, 'export default { routePreloadingBehavior: "none" };\n');
  writeBuildManifest({ outputRoot, commit: COMMIT });
  return {
    repoRoot,
    outputRoot,
    args: { env: {}, repoRoot, outputRoot, commit: COMMIT, requireLegacyPagesAbsent: false },
  };
}

test("ordinary OpenNext output still passes the artifact audit", (t) => {
  const { outputRoot, args } = fixture(t);
  assert.equal(checkOpenNextOutput(args).outputRoot, outputRoot);
});

test("nested linked file is rejected rather than omitted from the audit", (t) => {
  const { repoRoot, outputRoot, args } = fixture(t);
  const outside = path.join(repoRoot, "outside.js");
  fs.writeFileSync(outside, "secret");
  fs.symlinkSync(outside, path.join(outputRoot, "assets", "linked.js"));
  assert.throws(() => checkOpenNextOutput(args), /symbolic link is forbidden/);
});

test("linked directory is rejected rather than silently skipped", (t) => {
  const { repoRoot, outputRoot, args } = fixture(t);
  const outside = path.join(repoRoot, "outside");
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, ".env"), "private-value");
  fs.symlinkSync(outside, path.join(outputRoot, "assets", "linked"), "dir");
  assert.throws(() => checkOpenNextOutput(args), /symbolic link is forbidden/);
});

test("dangling symlink is rejected, not treated as an absent file", (t) => {
  const { repoRoot, outputRoot, args } = fixture(t);
  fs.symlinkSync(path.join(repoRoot, "missing"), path.join(outputRoot, "assets", "dangling"));
  assert.throws(() => checkOpenNextOutput(args), /symbolic link is forbidden/);
});

test("a symlinked required worker cannot pass the file check", (t) => {
  const { repoRoot, outputRoot, args } = fixture(t);
  const realWorker = path.join(repoRoot, "outside-worker.js");
  fs.renameSync(path.join(outputRoot, "worker.js"), realWorker);
  fs.symlinkSync(realWorker, path.join(outputRoot, "worker.js"));
  assert.throws(() => checkOpenNextOutput(args), /symbolic link is forbidden/);
});

test("symlinked output root is rejected by audit and manifest writer", (t) => {
  const { repoRoot, outputRoot, args } = fixture(t);
  const realOutput = path.join(repoRoot, "real-output");
  fs.renameSync(outputRoot, realOutput);
  fs.symlinkSync(realOutput, outputRoot, "dir");
  assert.throws(() => checkOpenNextOutput(args), /symbolic link is forbidden/);
  assert.throws(() => writeBuildManifest({ outputRoot, commit: COMMIT }), /symbolic link is forbidden/);
});

test("linked ancestor directory cannot redirect audit or manifest writes", (t) => {
  const { repoRoot, outputRoot, args } = fixture(t);
  const originalManifest = fs.readFileSync(
    path.join(outputRoot, "flamenode-build-manifest.json"), "utf8",
  );
  const linkedParent = path.join(repoRoot, "linked-parent");
  fs.symlinkSync(repoRoot, linkedParent, "dir");
  const nestedOutput = path.join(linkedParent, ".open-next");

  assert.throws(
    () => checkOpenNextOutput({ ...args, outputRoot: nestedOutput }),
    /symbolic link is forbidden/,
  );
  assert.throws(
    () => writeBuildManifest({ outputRoot: nestedOutput, commit: "b".repeat(40) }),
    /symbolic link is forbidden/,
  );
  assert.equal(
    fs.readFileSync(path.join(outputRoot, "flamenode-build-manifest.json"), "utf8"),
    originalManifest,
  );
});

test("dangling linked ancestor is rejected before creating an output directory", (t) => {
  const { repoRoot, args } = fixture(t);
  const linkedParent = path.join(repoRoot, "dangling-parent");
  fs.symlinkSync(path.join(repoRoot, "nonexistent"), linkedParent, "dir");
  const nestedOutput = path.join(linkedParent, ".open-next");

  assert.throws(
    () => checkOpenNextOutput({ ...args, outputRoot: nestedOutput }),
    /symbolic link is forbidden/,
  );
  assert.throws(
    () => writeBuildManifest({ outputRoot: nestedOutput, commit: COMMIT }),
    /symbolic link is forbidden/,
  );
  assert.equal(fs.existsSync(path.join(repoRoot, "nonexistent")), false);
});

test("manifest writer refuses a linked manifest without modifying its target", (t) => {
  const { repoRoot, outputRoot } = fixture(t);
  const manifestPath = path.join(outputRoot, "flamenode-build-manifest.json");
  const outside = path.join(repoRoot, "outside-manifest.json");
  fs.writeFileSync(outside, "must remain unchanged\n");
  fs.rmSync(manifestPath);
  fs.symlinkSync(outside, manifestPath);
  assert.throws(() => writeBuildManifest({ outputRoot, commit: COMMIT }), /symbolic link is forbidden/);
  assert.equal(fs.readFileSync(outside, "utf8"), "must remain unchanged\n");
});

test("existing forbidden-artifact validation remains active for regular files", (t) => {
  const { outputRoot, args } = fixture(t);
  fs.writeFileSync(path.join(outputRoot, "assets", ".env.production"), "accidental artifact");
  assert.throws(() => checkOpenNextOutput(args), /forbidden Pages\/config artifact/);
});
