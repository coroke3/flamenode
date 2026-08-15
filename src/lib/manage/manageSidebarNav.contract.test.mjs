import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("../../components/layout/ManageSidebarNav.tsx", import.meta.url),
  "utf8",
);

test("manage sidebarはlegacy/imported event idをroute-safeにhrefへ埋め込む", () => {
  assert.match(
    source,
    /const href = `\/manage\/events\/\$\{encodeURIComponent\(event\.id\)\}`;/,
  );
  assert.match(source, /title=\{event\.title\}/);
});
