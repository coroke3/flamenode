import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("./middlewareMaintenance.ts", import.meta.url),
  "utf8",
);

test("middleware maintenance reads are locally bounded and use KV edge caching", () => {
  assert.match(source, /MIDDLEWARE_MAINTENANCE_LOCAL_TTL_MS\s*=\s*5_000/);
  assert.match(source, /cacheTtl:\s*MIDDLEWARE_MAINTENANCE_KV_CACHE_TTL_SEC/);
  assert.match(source, /now\s*<\s*maintenanceCache\.expiresAt/);
  assert.match(source, /resetMiddlewareMaintenanceCacheForTests/);
});

test("middleware KV failure remains fail-open and cached briefly", () => {
  assert.match(source, /value:\s*false[\s\S]*expiresAt:\s*now\s*\+\s*MIDDLEWARE_MAINTENANCE_LOCAL_TTL_MS/);
  assert.match(source, /KV outage must not turn the middleware into a 500/);
});
