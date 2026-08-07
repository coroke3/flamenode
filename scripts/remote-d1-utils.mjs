#!/usr/bin/env node

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const ZERO_D1_DATABASE_ID = "00000000-0000-0000-0000-000000000000";

export function readWranglerD1DatabaseId(root = process.cwd()) {
  const wranglerPath = path.join(root, "wrangler.toml");
  if (!fs.existsSync(wranglerPath)) return null;
  const content = fs.readFileSync(wranglerPath, "utf8");
  const match = content.match(/database_id\s*=\s*"([^"]+)"/);
  return match?.[1] ?? null;
}

export function assertRemoteD1Configured(scriptName, root = process.cwd()) {
  const databaseId = readWranglerD1DatabaseId(root);
  if (!databaseId || databaseId === ZERO_D1_DATABASE_ID) {
    console.error(
      `[${scriptName}] wrangler.toml database_id is placeholder ${ZERO_D1_DATABASE_ID}; configure a real D1 database id before --remote.`,
    );
    process.exit(2);
  }
}

export function formatCommandFailure(error) {
  if (!error || typeof error !== "object") return String(error);
  const parts = [];
  if ("status" in error && error.status != null) {
    parts.push(`exit ${error.status}`);
  }
  const stdout = "stdout" in error ? String(error.stdout ?? "").trim() : "";
  const stderr = "stderr" in error ? String(error.stderr ?? "").trim() : "";
  if (stderr) parts.push(`stderr: ${stderr.slice(0, 500)}`);
  if (stdout) parts.push(`stdout: ${stdout.slice(0, 500)}`);
  if (parts.length === 0 && "message" in error) {
    parts.push(String(error.message));
  }
  return parts.join("; ") || "command failed";
}

export function parseWranglerD1Json(output) {
  const parsed = JSON.parse(output);
  const results = parsed?.[0]?.results ?? parsed?.results ?? null;
  if (!Array.isArray(results)) {
    throw new Error("Unexpected wrangler d1 execute output.");
  }
  return results;
}

export function runRemoteD1File(sqlPath, { scriptName }) {
  try {
    const output = execSync(
      `npx wrangler d1 execute flamenode_db --remote --json --file=${sqlPath}`,
      {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    return parseWranglerD1Json(output);
  } catch (error) {
    console.error(
      `[${scriptName}] remote D1 query failed: ${formatCommandFailure(error)}`,
    );
    throw error;
  }
}
