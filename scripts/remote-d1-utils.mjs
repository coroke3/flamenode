#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

export const ZERO_D1_DATABASE_ID = "00000000-0000-0000-0000-000000000000";

export function readWranglerD1DatabaseId(root = process.cwd()) {
  const wranglerPath = path.join(root, "wrangler.toml");
  if (!fs.existsSync(wranglerPath)) return null;
  const content = fs.readFileSync(wranglerPath, "utf8");
  const match = content.match(/database_id\s*=\s*"([^"]+)"/);
  return match?.[1] ?? null;
}

export function readEnvD1DatabaseId() {
  const raw =
    process.env.FLAMENODE_D1_DATABASE_ID?.trim() ||
    process.env.CLOUDFLARE_D1_DATABASE_ID?.trim() ||
    null;
  if (!raw || raw === ZERO_D1_DATABASE_ID) return null;
  return raw;
}

export function readRemoteD1DatabaseId(root = process.cwd()) {
  const envId = readEnvD1DatabaseId();
  if (envId) return envId;
  const wranglerId = readWranglerD1DatabaseId(root);
  if (wranglerId && wranglerId !== ZERO_D1_DATABASE_ID) return wranglerId;
  return null;
}

export function assertRemoteD1Configured(scriptName, root = process.cwd()) {
  if (readRemoteD1DatabaseId(root)) return;
  console.error(
    `[${scriptName}] wrangler.toml database_id is placeholder ${ZERO_D1_DATABASE_ID}; configure a real D1 database id before --remote.`,
  );
  console.error(
    `[${scriptName}] Set FLAMENODE_D1_DATABASE_ID=<uuid> in your environment without committing to git.`,
  );
  process.exit(2);
}

export function resolveRemoteD1ExecuteTarget(root = process.cwd()) {
  const envId = readEnvD1DatabaseId();
  if (envId) return envId;
  return "flamenode_db";
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

export function isWranglerExecutionSummary(row) {
  return (
    row != null &&
    typeof row === "object" &&
    "Total queries executed" in row
  );
}

export function parseWranglerD1Json(output) {
  const trimmed = String(output).trim();
  const jsonStart = trimmed.indexOf("[");
  if (jsonStart < 0) {
    throw new Error("Unexpected wrangler d1 execute output.");
  }
  const parsed = JSON.parse(trimmed.slice(jsonStart));
  const results = parsed?.[0]?.results ?? parsed?.results ?? null;
  if (!Array.isArray(results)) {
    throw new Error("Unexpected wrangler d1 execute output.");
  }
  return results.filter((row) => !isWranglerExecutionSummary(row));
}

export function normalizeRemoteD1Sql(sql) {
  return String(sql).replace(/\s+/g, " ").trim();
}

export function resolveWranglerCli(root = process.cwd()) {
  return path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
}

export function runRemoteD1File(sqlPath, { scriptName, root = process.cwd() }) {
  const databaseTarget = resolveRemoteD1ExecuteTarget(root);
  const sql = normalizeRemoteD1Sql(fs.readFileSync(sqlPath, "utf8"));
  const wranglerCli = resolveWranglerCli(root);
  try {
    const output = execFileSync(
      process.execPath,
      [
        wranglerCli,
        "d1",
        "execute",
        databaseTarget,
        "--remote",
        "--json",
        "--command",
        sql,
      ],
      {
        cwd: root,
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
