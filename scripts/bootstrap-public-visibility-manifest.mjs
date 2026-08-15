#!/usr/bin/env node

/**
 * Bootstrap the R2 visibility manifest exactly once before an enforce rollout.
 * This command is intentionally separate from resource creation and requires
 * an explicit confirmation flag. Existing manifests are never overwritten.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  emptyPublicVisibilityBlockedEntitiesManifest,
  normalizePublicVisibilityBlockedEntitiesManifest,
  PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY,
  PUBLIC_VISIBILITY_MANIFEST_MAX_BYTES,
} from "../src/lib/publicData/publicVisibilityManifestCore.ts";

const DEFAULT_BUCKET = "flamenode-storage";
const BUCKET_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

function utf8ByteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

export function validateBucketName(bucket) {
  const value = String(bucket ?? "").trim();
  if (!BUCKET_NAME_PATTERN.test(value)) {
    throw new Error("R2 bucket name is invalid");
  }
  return value;
}

/**
 * Pure bootstrap decision. `read` returns `{ found: false }` for a missing
 * object and `{ found: true, body }` for an existing object. `put` is called
 * at most once and only for a missing object.
 */
export function bootstrapPublicVisibilityManifest({
  read,
  put,
  nowSec = Math.floor(Date.now() / 1000),
}) {
  const current = read();
  if (current?.found) {
    let parsed;
    try {
      parsed = JSON.parse(String(current.body ?? ""));
    } catch {
      throw new Error("existing visibility manifest is malformed; refusing overwrite");
    }
    if (!normalizePublicVisibilityBlockedEntitiesManifest(parsed)) {
      throw new Error("existing visibility manifest is malformed; refusing overwrite");
    }
    return { action: "already_exists" };
  }

  const body = `${JSON.stringify(emptyPublicVisibilityBlockedEntitiesManifest(nowSec))}\n`;
  assert.ok(
    utf8ByteLength(body) <= PUBLIC_VISIBILITY_MANIFEST_MAX_BYTES,
    "bootstrap manifest unexpectedly exceeds size limit",
  );
  put(body);
  return { action: "created", body };
}

function localWranglerCli(root) {
  const cli = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
  if (!fs.existsSync(cli) || !fs.statSync(cli).isFile()) {
    throw new Error("local Wrangler CLI is missing; run npm ci before bootstrap");
  }
  return cli;
}

function isMissingObjectError(error) {
  const text = [error?.stdout, error?.stderr, error?.message]
    .filter(Boolean)
    .join(" ");
  return /not found|does not exist|404|NoSuchKey/i.test(text);
}

function readRemoteManifest({ root, bucket, key }) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "flamenode-visibility-bootstrap-"));
  const tempFile = path.join(tempDir, "manifest.json");
  try {
    try {
      execFileSync(
        process.execPath,
        [
          localWranglerCli(root),
          "r2",
          "object",
          "get",
          `${bucket}/${key}`,
          "--remote",
          `--file=${tempFile}`,
        ],
        { cwd: root, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (error) {
      if (isMissingObjectError(error)) return { found: false };
      throw new Error("R2 visibility manifest read failed");
    }
    const body = fs.readFileSync(tempFile, "utf8");
    if (utf8ByteLength(body) > PUBLIC_VISIBILITY_MANIFEST_MAX_BYTES) {
      throw new Error("R2 visibility manifest exceeds size limit");
    }
    return { found: true, body };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function putRemoteManifest({ root, bucket, key, body }) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "flamenode-visibility-bootstrap-"));
  const tempFile = path.join(tempDir, "manifest.json");
  try {
    fs.writeFileSync(tempFile, body, "utf8");
    try {
      execFileSync(
        process.execPath,
        [
          localWranglerCli(root),
          "r2",
          "object",
          "put",
          `${bucket}/${key}`,
          "--remote",
          `--file=${tempFile}`,
          "--content-type=application/json",
          "--cache-control=no-store",
          "--force",
        ],
        { cwd: root, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch {
      throw new Error("R2 visibility manifest bootstrap write failed");
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export function bootstrapRemoteVisibilityManifest({
  root = process.cwd(),
  bucket = DEFAULT_BUCKET,
  nowSec,
  read = () => readRemoteManifest({
    root,
    bucket,
    key: PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY,
  }),
  put = (body) => putRemoteManifest({
    root,
    bucket,
    key: PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY,
    body,
  }),
}) {
  const normalizedBucket = validateBucketName(bucket);
  const result = bootstrapPublicVisibilityManifest({ read, put, nowSec });
  console.log(
    result.action === "created"
      ? `[cf:bootstrap-visibility] created ${PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY} in ${normalizedBucket}`
      : `[cf:bootstrap-visibility] existing manifest verified; no overwrite (${normalizedBucket})`,
  );
  return result;
}

function isMain() {
  return Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isMain()) {
  if (!process.argv.includes("--confirm-bootstrap")) {
    console.error(
      "[cf:bootstrap-visibility] No changes made. Re-run with --confirm-bootstrap only before an enforce rollout.",
    );
    process.exitCode = 1;
  } else {
    try {
      const bucketArgIndex = process.argv.indexOf("--bucket");
      const bucket = bucketArgIndex >= 0
        ? process.argv[bucketArgIndex + 1]
        : process.env.CF_R2_BUCKET_NAME ?? DEFAULT_BUCKET;
      bootstrapRemoteVisibilityManifest({ bucket });
    } catch (error) {
      console.error(
        `[cf:bootstrap-visibility] FAILED: ${error instanceof Error ? error.message : "unknown error"}`,
      );
      process.exitCode = 1;
    }
  }
}
