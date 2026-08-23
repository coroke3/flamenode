import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const wrangler = await readFile(
  new URL("../../wrangler.toml", import.meta.url),
  "utf8",
);

test("Web WorkerはSmart Placementを使い静的assetsはedge直配信を維持する", () => {
  assert.match(wrangler, /\[placement\][\s\S]*?mode\s*=\s*"smart"/);
  assert.match(
    wrangler,
    /\[assets\][\s\S]*?directory\s*=\s*"\.open-next\/assets"[\s\S]*?run_worker_first\s*=\s*false/,
  );
  assert.match(
    wrangler,
    /\[\[services\]\][\s\S]*?binding\s*=\s*"WORKER_SELF_REFERENCE"[\s\S]*?service\s*=\s*"flamenode-web"/,
  );
});
