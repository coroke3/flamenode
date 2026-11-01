import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseCronExpressions, parseQueueConsumerBlocks, readWorkerConfigs } from "./free-tier-worker-configs.mjs";
import { WORKER_TARGETS } from "./new-worker-dry-run.mjs";

function withFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flamenode-free-tier-"));
  try {
    fs.mkdirSync(path.join(root, "workers", "current"), { recursive: true });
    fs.mkdirSync(path.join(root, "workers", "unconfigured"));
    fs.writeFileSync(path.join(root, "workers", "current", "wrangler.toml"), 'name = "current"\n');
    for (const target of WORKER_TARGETS) {
      const configPath = path.join(root, target.config);
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, `name = "${target.name}"\n`);
    }
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("free-tier audit includes CURRENT and all TARGET Worker configs", () => {
  withFixture((root) => {
    const configs = readWorkerConfigs(root);
    const paths = configs.map(({ filePath }) => path.relative(root, filePath).split(path.sep).join("/"));
    assert.deepEqual(paths, ["workers/current/wrangler.toml", ...WORKER_TARGETS.map((target) => target.config)]);
    assert.deepEqual(configs.map(({ text }) => text.trim()), [
      'name = "current"', 'name = "site"', 'name = "api"', 'name = "app"',
    ]);
  });
});

test("free-tier audit refuses a missing TARGET Worker config", () => {
  withFixture((root) => {
    fs.rmSync(path.join(root, "apps", "api", "wrangler.toml"));
    assert.throws(() => readWorkerConfigs(root), /ENOENT/);
  });
});

test("free-tier parsers see cron and consumer lines with end-of-line comments", () => {
  const text = [
    "[triggers]",
    'crons = ["*/5 * * * *", "0 # x * * *"] # nightly',
    "[[queues.consumers]] # wake",
    'queue = "q"',
    "max_retries = 3 # bounded",
    '# crons = ["commented"]',
  ].join("\n");
  assert.deepEqual(parseCronExpressions(text), ["*/5 * * * *", "0 # x * * *"]);
  const blocks = parseQueueConsumerBlocks(text);
  assert.equal(blocks.length, 1);
  assert.match(blocks[0], /^max_retries\s*=\s*3\s*$/m);
});

test("free-tier audit passes TARGET limits, cron and consumer declarations to the checker", () => {
  withFixture((root) => {
    const apiConfig = path.join(root, "apps", "api", "wrangler.toml");
    fs.writeFileSync(apiConfig, '[limits]\ncpu_ms = 100\n[triggers]\ncrons = ["* * * * *"]\n[[queues.consumers]]\nqueue = "example"\n');
    const configs = readWorkerConfigs(root);
    assert.match(configs.find(({ filePath }) => filePath === apiConfig).text, /cpu_ms = 100[\s\S]*crons = \[[\s\S]*\[\[queues\.consumers\]\]/);
  });
});
