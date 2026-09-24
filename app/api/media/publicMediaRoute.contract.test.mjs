import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./[...key]/route.ts", import.meta.url), "utf8");

test("public media Cache API hit precedes binding lookup and skips a second lookup", () => {
  assert.match(source, /isValidPublicMediaKey\(rawKey\)/);
  assert.ok(
    source.indexOf("getCachedPublicMediaResponse(request, rawKey)") <
      source.indexOf("getEnv()"),
  );
  assert.match(source, /skipEdgeCacheLookup: true/);
});
