import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const layout = await readFile(new URL("../../app/layout.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../styles/globals.css", import.meta.url), "utf8");

test("Cloudflare build does not fetch Google Fonts and keeps local brand font", () => {
  assert.doesNotMatch(layout, /next\/font\/google/);
  assert.match(layout, /localFont\(/);
  assert.match(layout, /\.\/fonts\/FlameNodeSans\.otf/);
  assert.match(layout, /className=\{flameNodeSans\.variable\}/);
  assert.match(styles, /--font-jost:\s*system-ui\s*;/);
  assert.match(styles, /--font-manrope:\s*system-ui\s*;/);
  assert.match(styles, /--font-noto-jp:\s*"Hiragino Sans"/);
  assert.match(styles, /--font-jetbrains:\s*ui-monospace\s*;/);
});
