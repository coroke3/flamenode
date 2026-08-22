import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const styles = await readFile(
  new URL("./AccountMenu.module.css", import.meta.url),
  "utf8",
);

test("account menu opening does not add an accent frame or drop shadow", () => {
  assert.match(
    styles,
    /\.triggerActive\s*\{[\s\S]*?background-color:\s*transparent;[\s\S]*?border-color:\s*transparent;/,
  );
  assert.match(
    styles,
    /\.popover\s*\{[\s\S]*?box-shadow:\s*none;/,
  );
  assert.doesNotMatch(
    styles,
    /\.triggerActive[\s\S]*?accent-primary/,
  );
});

test("account menu keeps a neutral keyboard focus indicator", () => {
  assert.match(
    styles,
    /\.trigger:focus-visible\s*\{[\s\S]*?outline:\s*2px\s+solid\s+var\(--border-strong,\s*var\(--text-muted\)\);/,
  );
  assert.match(
    styles,
    /\.menuItem:focus-visible,[\s\S]*?\.xidOption:focus-visible\s*\{[\s\S]*?outline:\s*2px\s+solid\s+var\(--border-strong,\s*var\(--text-muted\)\);/,
  );
});
