import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("restore failure batch converts raw db.run statements for D1", async () => {
  const source = await readFile(new URL("./restore.ts", import.meta.url), "utf8");
  assert.match(source, /const statements = \[/);
  assert.match(
    source,
    /\.map\(\(statement\) => asBatchRunnable\(args\.db, statement\)\)/,
  );
});
