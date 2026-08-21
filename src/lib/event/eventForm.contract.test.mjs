import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readRepoFile(path) {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}

test("blank create-event IDs are omitted for server-side auto-generation", () => {
  const source = readRepoFile("src/lib/event/eventForm.ts");

  assert.match(source, /function normalizeOptionalEventId\(value: unknown\)/);
  assert.match(source, /typeof value === "string" && value\.trim\(\) === ""/);
  assert.match(source, /id: z\.preprocess\(/);
});

test("create-event IDs are validated server-side with the route-safe pattern", () => {
  const source = readRepoFile("src/lib/actions/event-admin.ts");

  assert.match(
    source,
    /const id = data\.id\?\.trim\(\) \|\| generateId\("ev"\);[\s\S]*?if \(!EVENT_ID_PATTERN\.test\(id\)\)/,
  );
});
