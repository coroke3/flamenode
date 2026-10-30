// MIG-0707 U05c: styles are copied byte-for-byte from CURRENT, without recompilation.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { buildSharedCss, MODULES } from "../scripts/portCssModule.mjs";

const root = new URL("../../../", import.meta.url);
const read = (path) => readFile(new URL(path, root));
const cssNames = [
  "globals", "redesign-public", "mobile-public",
  "admin-manage", "admin-mobile", "mobile-hardening",
];

test("MIG-0707 T07: six Ops CSS files are byte-identical to CURRENT", async () => {
  for (const name of cssNames) {
    const [current, ops] = await Promise.all([
      read(`src/styles/${name}.css`),
      read(`apps/ops/src/styles/current/${name}.css`),
    ]);
    assert.ok(current.equals(ops), `${name}.css must match CURRENT bytes`);
  }
});

test("MIG-0707 T07: Ops font and font-face CSS match Personal/CURRENT", async () => {
  const [currentFont, opsFont, personalFontCss, opsFontCss] = await Promise.all([
    read("app/fonts/FlameNodeSans.otf"),
    read("apps/ops/src/assets/FlameNodeSans.otf"),
    read("apps/app/src/styles/fonts.css"),
    read("apps/ops/src/styles/fonts.css"),
  ]);
  assert.ok(currentFont.equals(opsFont), "FlameNode Sans font differs from CURRENT");
  assert.ok(personalFontCss.equals(opsFontCss), "font-face declaration differs from Personal SPA");
});

test("MIG-0707 U05c: global CSS loads in CURRENT order before Ops React", async () => {
  const main = (await read("apps/ops/src/main.tsx")).toString("utf8");
  const imports = [...main.matchAll(/^import "([^"]+\.css)";$/gm)].map((match) => match[1]);
  assert.deepEqual(imports, [
    "./styles/current/globals.css",
    "./styles/current/mobile-hardening.css",
    "./styles/fonts.css",
    "./styles/shared.css",
  ]);
});

test("MIG-0707 U05c: shared CSS remains generated from CURRENT modules", async () => {
  const built = (await read("apps/ops/src/styles/shared.css")).toString("utf8");
  assert.equal(built, buildSharedCss(), "regenerate with node apps/ops/scripts/portCssModule.mjs");
  assert.ok(built.startsWith("/* MIG-0724: Ops shared CSS loads video-review styling without Node.js ESM CSS imports. */\n@import \"./video-review.css\";\n\n"), "MIG-0724 review CSS import must be generated");
  const reviewCss = (await read("apps/ops/src/styles/video-review.css")).toString("utf8");
  assert.match(reviewCss, /\.video-review-detail-panel\s*\{/);
  assert.equal(MODULES.length, 3);
  assert.match(built, /\.empty-tone-warning \.empty-icon/);
  assert.match(built, /\.confirm-dialog/);
  assert.match(built, /\.sectabs-tabs/);
  assert.doesNotMatch(built, /:global\(/, "CSS modules must not leak :global tokens");
});
