// MIG-0730 U01b: shared stylesheet must exactly preserve Personal member form CSS.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const root = new URL("../../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("MIG-0730 U01b: shared member CSS remains byte-identical to the original Personal stylesheet", async () => {
  const [shared, personal] = await Promise.all([
    read("packages/ui/src/styles/video-members.css"),
    read("apps/app/src/styles/video-members.css"),
  ]);
  assert.ok(shared.length > 1500);
  assert.equal(shared, personal);
  const names = new Set([...shared.matchAll(/\.vmembers-[A-Za-z][\w-]*/g)].map(m => m[0].slice(1)));
  assert.ok(names.has("vmembers-root"));
  assert.ok(names.has("vmembers-sampleTableScroll"));
  assert.ok(names.has("vmembers-bulkPreviewTable"));
});

test("MIG-0730 U01b: both SPA entrypoints import only the shared member CSS once", async () => {
  const [app, ops, pkg, field] = await Promise.all([
    read("apps/app/src/main.tsx"),
    read("apps/ops/src/main.tsx"),
    read("packages/ui/package.json"),
    read("packages/ui/src/forms/videoMembers/VideoMembersField.tsx"),
  ]);
  const cssImport = 'import "@flamenode/ui/styles/video-members.css";';
  assert.equal(app.split(cssImport).length - 1, 1);
  assert.equal(ops.split(cssImport).length - 1, 1);
  assert.doesNotMatch(app, /import "\.\/styles\/video-members\.css"/);
  assert.match(field, /vmembers-root/);
  const exported = JSON.parse(pkg).exports;
  assert.equal(exported["./styles/video-members.css"], "./src/styles/video-members.css");
});

test("MIG-0730 U01b: every form-specific vmembers class in Personal field has a shared CSS definition", async () => {
  const [field, css] = await Promise.all([
    read("packages/ui/src/forms/videoMembers/VideoMembersField.tsx"),
    read("packages/ui/src/styles/video-members.css"),
  ]);
  const used = new Set([...field.matchAll(/\bvmembers-[A-Za-z][\w-]*/g)].map(m => m[0]));
  const defined = new Set([...css.matchAll(/\.vmembers-[A-Za-z][\w-]*/g)].map(m => m[0].slice(1)));
  assert.ok(used.size > 10);
  for (const name of used) assert.ok(defined.has(name), `no CSS definition: ${name}`);
});
