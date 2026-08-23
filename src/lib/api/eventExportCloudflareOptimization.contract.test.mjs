import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(
  new URL("../../../app/api/event-endpoints/[id]/route.ts", import.meta.url),
  "utf8",
);
const wrangler = await readFile(
  new URL("../../../wrangler.toml", import.meta.url),
  "utf8",
);

test("event exportのKV HITは検証済みmetadataを使い毎回巨大JSONを再parseしない", () => {
  assert.match(route, /EVENT_EXPORT_CACHE_METADATA_MARKER/);
  assert.match(route, /getWithMetadata\(cacheKey/);
  assert.match(route, /isTrustedCacheMetadata\(metadata, format\)/);
  assert.match(route, /if \(isTrustedCacheMetadata\(metadata, format\)\) return cached/);
  assert.match(route, /metadata:\s*cacheMetadataForFormat\(format\)/);

  const trustedIndex = route.indexOf("if (isTrustedCacheMetadata(metadata, format)) return cached");
  const parseIndex = route.indexOf("const parsed = JSON.parse(cached)");
  assert.ok(trustedIndex >= 0 && parseIndex > trustedIndex);
  assert.match(route.slice(parseIndex), /assertNoForbiddenKeys\(parsed\)/);
});

test("scheduled exportはKV HITでもD1公開可否確認を先に維持する", () => {
  const authIndex = route.indexOf("prefetchedEvent = await loadEventExportEvent");
  const cacheIndex = route.indexOf("const response = await cachedResponse()");
  assert.ok(authIndex >= 0 && cacheIndex > authIndex);
});

test("web WorkerはSmart Placementを有効化し静的assetはWorkerを迂回する", () => {
  assert.match(wrangler, /\[placement\]\s*\nmode\s*=\s*"smart"/);
  assert.match(
    wrangler,
    /\[assets\][\s\S]*run_worker_first\s*=\s*false/,
  );
});
