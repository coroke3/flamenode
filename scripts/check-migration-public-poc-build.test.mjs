import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectPublicFixtureBuild } from "./check-migration-public-poc-build.mjs";

const publicHtml = '<main data-synthetic-only="true">Synthetic public video</main>';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "flamenode-poc-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "public_demo"));
  mkdirSync(join(dir, "islands"));
  writeFileSync(join(dir, "public_demo/index.html"), publicHtml);
  writeFileSync(join(dir, "islands/index.html"), "Synthetic island PoC");
  return dir;
}

test("normal synthetic fixture output retains existing acceptance", (t) => {
  const dir = fixture(t);
  assert.deepEqual(inspectPublicFixtureBuild(dir), []);
  assert.match(inspectPublicFixtureBuild(join(dir, "missing")).join("\n"), /output directory absent/);
});

test("linked public fixture directory cannot be accepted from outside output", (t) => {
  const dir = fixture(t);
  rmSync(join(dir, "public_demo"), { recursive: true });
  const outside = mkdtempSync(join(tmpdir(), "flamenode-poc-external-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, "index.html"), publicHtml);
  symlinkSync(outside, join(dir, "public_demo"), "dir");
  assert.match(inspectPublicFixtureBuild(dir).join("\n"), /symlink in fixture output: public_demo/);
});

test("linked public and island HTML files are rejected", (t) => {
  const dir = fixture(t);
  const outside = join(dir, "outside.html");
  writeFileSync(outside, publicHtml);
  rmSync(join(dir, "public_demo/index.html"));
  symlinkSync(outside, join(dir, "public_demo/index.html"));
  assert.match(inspectPublicFixtureBuild(dir).join("\n"), /public fixture HTML absent or not a real file/);

  rmSync(join(dir, "islands/index.html"));
  symlinkSync(outside, join(dir, "islands/index.html"));
  assert.match(inspectPublicFixtureBuild(dir).join("\n"), /islands fixture HTML is not a real file/);
});

test("linked output root and dangling private fixture are rejected", (t) => {
  const dir = fixture(t);
  const wrapper = mkdtempSync(join(tmpdir(), "flamenode-poc-wrapper-"));
  t.after(() => rmSync(wrapper, { recursive: true, force: true }));
  symlinkSync(dir, join(wrapper, "linked"), "dir");
  assert.match(inspectPublicFixtureBuild(join(wrapper, "linked")).join("\n"), /not a real directory/);

  symlinkSync(join(dir, "does-not-exist"), join(dir, "private_demo"), "dir");
  assert.match(inspectPublicFixtureBuild(dir).join("\n"), /private fixture produced an HTML route/);
});

test("linked islands directory cannot be accepted as a fixture", (t) => {
  const dir = fixture(t);
  rmSync(join(dir, "islands"), { recursive: true });
  const outside = mkdtempSync(join(tmpdir(), "flamenode-poc-external-islands-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, "index.html"), "Synthetic island PoC");
  symlinkSync(outside, join(dir, "islands"), "dir");
  const failures = inspectPublicFixtureBuild(dir).join("\n");
  assert.match(failures, /symlink in fixture output: islands/);
  assert.match(failures, /islands fixture HTML is not a real file/);
});

test("nested file and directory symlinks at any depth are rejected, including dangling ones", (t) => {
  const dir = fixture(t);
  const outside = mkdtempSync(join(tmpdir(), "flamenode-poc-external-nested-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, "leak.html"), publicHtml);
  symlinkSync(join(outside, "leak.html"), join(dir, "public_demo/leaked.html"));
  assert.match(inspectPublicFixtureBuild(dir).join("\n"), /symlink in fixture output: public_demo\/leaked\.html/);
  rmSync(join(dir, "public_demo/leaked.html"));

  symlinkSync(outside, join(dir, "islands/nested-private"), "dir");
  assert.match(inspectPublicFixtureBuild(dir).join("\n"), /symlink in fixture output: islands\/nested-private/);
  rmSync(join(dir, "islands/nested-private"));

  mkdirSync(join(dir, "public_demo/a/b"), { recursive: true });
  symlinkSync(join(dir, "gone"), join(dir, "public_demo/a/b/dangling"));
  assert.match(inspectPublicFixtureBuild(dir).join("\n"), /symlink in fixture output: public_demo\/a\/b\/dangling/);
});
