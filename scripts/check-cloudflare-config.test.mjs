import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkCloudflareConfig } from "./check-cloudflare-config.mjs";

function createRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flamenode-retired-ids-"));
  fs.mkdirSync(path.join(root, "cloudflare"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function retiredConfigErrors(root) {
  // The unrelated tracked-template errors are expected for the minimal fixture.
  return checkCloudflareConfig({ root, env: {}, verify: () => {} })
    .filter((message) => message.includes("cloudflare/ids.json"));
}

test("missing retired ids.json is allowed", (t) => {
  const root = createRoot(t);
  assert.deepEqual(retiredConfigErrors(root), []);
});

test("regular retired ids.json remains rejected", (t) => {
  const root = createRoot(t);
  fs.writeFileSync(path.join(root, "cloudflare", "ids.json"), "{}");
  assert.match(retiredConfigErrors(root).join("\n"), /ids\.json is retired/);
});

test("dangling symlink is rejected even though existsSync returns false", (t) => {
  const root = createRoot(t);
  const link = path.join(root, "cloudflare", "ids.json");
  fs.symlinkSync(path.join(root, "missing-config.json"), link);
  assert.equal(fs.existsSync(link), false);
  assert.match(retiredConfigErrors(root).join("\n"), /ids\.json is retired/);
});

test("symlink to a file outside the repository is rejected", (t) => {
  const root = createRoot(t);
  const external = path.join(os.tmpdir(), path.basename(root) + "-outside.json");
  fs.writeFileSync(external, "{}");
  t.after(() => fs.rmSync(external, { force: true }));
  fs.symlinkSync(external, path.join(root, "cloudflare", "ids.json"));
  assert.match(retiredConfigErrors(root).join("\n"), /ids\.json is retired/);
});

test("directory using the retired ids.json name is rejected", (t) => {
  const root = createRoot(t);
  fs.mkdirSync(path.join(root, "cloudflare", "ids.json"));
  assert.match(retiredConfigErrors(root).join("\n"), /ids\.json is retired/);
});
