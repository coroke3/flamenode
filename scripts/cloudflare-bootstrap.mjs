#!/usr/bin/env node
/**
 * Provision the three shared Cloudflare data resources without persisting or
 * printing their production IDs. This command never creates a Pages project,
 * applies a D1 migration, deploys a Worker, or writes a repository file.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const BOOTSTRAP_STEPS = Object.freeze([
  Object.freeze({ label: "D1 database", args: ["d1", "create", "flamenode_db"] }),
  Object.freeze({ label: "R2 bucket", args: ["r2", "bucket", "create", "flamenode-storage"] }),
  Object.freeze({ label: "KV namespace", args: ["kv", "namespace", "create", "FLAMENODE_KV"] }),
]);

function localWranglerCli(root) {
  const cli = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
  if (!fs.existsSync(cli) || !fs.statSync(cli).isFile()) {
    throw new Error("local Wrangler CLI is missing; run npm ci before bootstrap");
  }
  return cli;
}

function runWrangler({ root, args }) {
  const cli = localWranglerCli(root);
  try {
    // stdout/stderr can contain account or resource IDs. Capture and discard it.
    execFileSync(process.execPath, [cli, ...args], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error("Wrangler command failed; child output was suppressed to avoid leaking Cloudflare identifiers");
  }
}

export function bootstrapCloudflareResources({ root = process.cwd(), run = runWrangler } = {}) {
  run({ root, args: ["whoami"] });
  for (const step of BOOTSTRAP_STEPS) {
    console.log(`[cf:bootstrap] creating ${step.label}`);
    run({ root, args: [...step.args] });
    console.log(`[cf:bootstrap] ${step.label} created (identifier intentionally not printed or saved)`);
  }
}

function isMain() {
  return Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isMain()) {
  if (!process.argv.includes("--confirm-create")) {
    console.error(
      "[cf:bootstrap] No changes made. Re-run with --confirm-create only when you intend to create D1, R2, and KV resources.",
    );
    process.exitCode = 1;
  } else {
    try {
      bootstrapCloudflareResources();
      console.log(
        [
          "[cf:bootstrap] Resource creation finished.",
          "Copy the identifiers from the Cloudflare Dashboard directly into Workers Builds variables:",
          "CLOUDFLARE_ACCOUNT_ID, CF_D1_DATABASE_ID, CF_KV_NAMESPACE_ID, and CF_R2_BUCKET_NAME.",
          "Also set NODE_VERSION=22 and SKIP_DEPENDENCY_INSTALL=true.",
          "No Pages project, migration, deployment, secret update, or local ID artifact was created.",
        ].join("\n"),
      );
    } catch (error) {
      console.error(`[cf:bootstrap] FAILED: ${error instanceof Error ? error.message : "unknown error"}`);
      process.exitCode = 1;
    }
  }
}
