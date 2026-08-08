import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deployProduction } from "./cloudflare-deploy-production.mjs";

const COMMIT = "1234567890abcdef1234567890abcdef12345678";

function withTempDirectory(prefix, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return callback(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("production deploy applies guarded index migrations before strict schema preflight and workers", () =>
  withTempDirectory("flamenode-deploy-safe-migration-order-", (repoRoot) => {
    const fakeOpenNext = path.join(repoRoot, "opennext.mjs");
    const fakeWrangler = path.join(repoRoot, "wrangler.mjs");
    fs.writeFileSync(fakeOpenNext, "// fixture\n", "utf8");
    fs.writeFileSync(fakeWrangler, "// fixture\n", "utf8");

    const labels = [];
    const configs = {
      web: "web.toml",
      "fast-jobs": "fast.toml",
      "content-jobs": "content.toml",
      "sync-jobs": "sync.toml",
    };
    const env = {
      CLOUDFLARE_OPENNEXT_BIN: fakeOpenNext,
      CLOUDFLARE_WRANGLER_BIN: fakeWrangler,
    };

    deployProduction({
      env,
      repoRoot,
      verify: () => ({ commit: COMMIT }),
      prepareConfigs: () => configs,
      checkOutput: () => labels.push("output"),
      secretPreflight: () => labels.push("secrets"),
      uploadSizePreflight: () => labels.push("upload-sizes"),
      safeMigrationApply: () => labels.push("safe-migration-apply"),
      schemaPreflight: () => labels.push("strict-schema-preflight"),
      run: ({ label }) => {
        labels.push(label);
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    assert.deepEqual(labels, [
      "output",
      "secrets",
      "upload-sizes",
      "safe-migration-apply",
      "strict-schema-preflight",
      "cloudflare-deploy:flamenode-content-jobs",
      "cloudflare-deploy:flamenode-fast-jobs",
      "cloudflare-deploy:flamenode-sync-jobs",
      "cloudflare-deploy:flamenode-web",
    ]);
  }));

test("migration failure stops every worker deploy", () =>
  withTempDirectory("flamenode-deploy-safe-migration-failure-", (repoRoot) => {
    const fakeOpenNext = path.join(repoRoot, "opennext.mjs");
    const fakeWrangler = path.join(repoRoot, "wrangler.mjs");
    fs.writeFileSync(fakeOpenNext, "// fixture\n", "utf8");
    fs.writeFileSync(fakeWrangler, "// fixture\n", "utf8");

    const workerDeploys = [];
    assert.throws(
      () =>
        deployProduction({
          env: {
            CLOUDFLARE_OPENNEXT_BIN: fakeOpenNext,
            CLOUDFLARE_WRANGLER_BIN: fakeWrangler,
          },
          repoRoot,
          verify: () => ({ commit: COMMIT }),
          prepareConfigs: () => ({
            web: "web.toml",
            "fast-jobs": "fast.toml",
            "content-jobs": "content.toml",
            "sync-jobs": "sync.toml",
          }),
          checkOutput: () => undefined,
          secretPreflight: () => undefined,
          uploadSizePreflight: () => undefined,
          safeMigrationApply: () => {
            throw new Error("fixture migration failure");
          },
          schemaPreflight: () => {
            throw new Error("must not reach strict preflight");
          },
          run: ({ label }) => workerDeploys.push(label),
        }),
      /fixture migration failure/,
    );
    assert.deepEqual(workerDeploys, []);
  }));
