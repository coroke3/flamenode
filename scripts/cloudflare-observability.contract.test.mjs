import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const configs = [
  "../wrangler.toml",
  "../workers/fast-jobs/wrangler.toml",
  "../workers/sync-jobs/wrangler.toml",
  "../workers/content-jobs/wrangler.toml",
];

test("production Worker configsはCloudflare observabilityを明示的に有効化する", async () => {
  for (const relative of configs) {
    const source = await readFile(new URL(relative, import.meta.url), "utf8");
    assert.match(source, /\[observability\][\s\S]*?enabled\s*=\s*true/);
  }
});

test("background Workerはqueue consumerを単一concurrencyに保つ", async () => {
  for (const relative of configs.slice(1)) {
    const source = await readFile(new URL(relative, import.meta.url), "utf8");
    assert.match(source, /max_concurrency\s*=\s*1/);
  }
});
