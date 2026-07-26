import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

test("bodyScrollLock exports acquireBodyScrollLock", () => {
  const source = readFileSync(
    path.join(root, "src/components/layout/bodyScrollLock.ts"),
    "utf8",
  );
  assert.match(source, /export function\s*\n?acquireBodyScrollLock/);
  assert.match(source, /state\.count/);
  assert.match(source, /window\.scrollTo/);
});

test("VideoUtilityDock uses acquireBodyScrollLock", () => {
  const source = readFileSync(
    path.join(root, "src/components/video/VideoUtilityDock.tsx"),
    "utf8",
  );
  assert.match(source, /acquireBodyScrollLock/);
  assert.doesNotMatch(source, /body\.style\.overflow = "hidden"/);
});
