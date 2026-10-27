// MIG-0701 U04 (D-13-5): exact original CSS/font, derived modules and class coverage.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { MODULES, portCssModule } from "../scripts/portCssModule.mjs";
const root = new URL("../../../", import.meta.url);
const read = (p) => readFile(new URL(p, root), "utf8");
const names = ["globals", "redesign-public", "mobile-public", "admin-manage", "admin-mobile", "mobile-hardening"];

test("MIG-0701 U04 T07: CURRENT CSS and font are byte-identical", async () => {
  for (const n of names) assert.equal(await read("src/styles/" + n + ".css"), await read("apps/app/src/styles/current/" + n + ".css"), n);
  const [a, b] = await Promise.all([
    readFile(new URL("app/fonts/FlameNodeSans.otf", root)),
    readFile(new URL("apps/app/src/assets/FlameNodeSans.otf", root)),
  ]);
  assert.ok(a.equals(b));
});
test("MIG-0701 U04 T07: generated CSS modules match CURRENT without :global", async () => {
  for (const [prefix, from, to] of MODULES) {
    const output = await read(to);
    assert.equal(output, portCssModule(await read(from), prefix), to);
    assert.equal(output.includes(":global("), false, to);
  }
});
async function getTsx(dir) {
  const entries = await readdir(new URL(dir, root), { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const p = dir + entry.name;
    if (entry.isDirectory()) out.push(...await getTsx(p + "/"));
    else if (entry.isFile() && p.endsWith(".tsx")) out.push(p);
  }
  return out;
}
test("MIG-0701 U04 T08: every Personal route class has a CSS definition", async () => {
  const css = (await Promise.all([
    ...names.map((n) => read("apps/app/src/styles/current/" + n + ".css")),
    ...MODULES.map(([, , to]) => read(to)),
  ])).join("\n");
  const defined = new Set([...css.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((m) => m[1]));
  const exceptions = new Set([
    "fn-pc-status-banner--warn",
    "settings-panel-x", "settings-panel-history", "settings-panel-link", "settings-panel-discord",
    "settings-x-h", "settings-history-h", "settings-link-h", "settings-discord-h",
  ]);
  const missing = new Set();
  for (const p of await getTsx("apps/app/src/routes/")) {
    const source = (await read(p)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const [, token] of source.matchAll(/(?<![\w-])((?:fn|dash|onb|settings|vcard)-[A-Za-z0-9_-]*[A-Za-z0-9_])/g)) {
      if (!defined.has(token) && !exceptions.has(token)) missing.add(p + ": " + token);
    }
  }
  assert.deepEqual([...missing].sort(), [], "missing Personal CSS definitions");
});
test("MIG-0701 U04 T07: main imports CSS in CURRENT order", async () => {
  const actual = [...(await read("apps/app/src/main.tsx")).matchAll(/^import "(.+\.css)";$/gm)].map((m) => m[1]);
  assert.deepEqual(actual, [
    "./styles/current/globals.css", "./styles/current/mobile-hardening.css",
    "./styles/fonts.css", "./styles/video-card.css", "./styles/dashboard.css",
    "./styles/settings.css", "./styles/onboarding.css",
  ]);
});
