import assert from "node:assert/strict";
import { test } from "node:test";
import { GET, runtime } from "./route.ts";

test("Pages health endpoint is binding-free and edge-safe", async () => {
  assert.equal(runtime, "edge");
  const response = GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), {
    ok: true,
    service: "flamenode-pages",
    runtime: "edge",
  });
});
