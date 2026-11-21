#!/usr/bin/env node
/**
 * SEC-726 pre-cutover gate for the pending SEC-713 Auth.js session reader.
 * Read-only and aggregate-only: never emit user IDs, selected X IDs, or tokens.
 *
 * LOCAL:  node scripts/check-sec-726-active-x.mjs --database=<local-sqlite-path>
 * REMOTE: node scripts/check-sec-726-active-x.mjs --remote
 * Remote access needs separately authorized read-only D1 preflight credentials;
 * this script does not authorize or initiate any production migration/repair.
 *
 * Exit: 0 = all persisted selections match the SEC-713 read contract;
 *       1 = one or more incompatible selections (STOP cutover);
 *       2 = unavailable/malformed preflight (also STOP cutover).
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import {
  assertRemoteD1Configured,
  runRemoteD1File,
} from "./remote-d1-utils.mjs";

const SCRIPT = "check:sec-726-active-x";
const ROOT = process.cwd();
// SQL source is anchored to this reviewed file, never to an untrusted cwd.
const SQL_PATH = fileURLToPath(new URL("./sql/check-sec-726-active-x.sql", import.meta.url));

function parseMode(args) {
  const dbArgs = args.filter((x) => x.startsWith("--database="));
  const remote = args.includes("--remote");
  if (dbArgs.length > 1 || (remote && dbArgs.length > 0) ||
      args.length !== (remote ? 1 : dbArgs.length) || (!remote && dbArgs.length !== 1)) {
    throw new Error("Choose exactly --database=<local-path> OR --remote; no implicit D1 target.");
  }
  if (dbArgs.length > 0 && !dbArgs[0].slice("--database=".length)) {
    throw new Error("--database requires a local SQLite path.");
  }
  return remote ? { remote: true } : { remote: false, file: dbArgs[0].slice("--database=".length) };
}

function inspect(mode) {
  if (!fs.existsSync(SQL_PATH)) throw new Error("SEC-726 aggregate SQL file is missing.");
  if (mode.remote) {
    assertRemoteD1Configured(SCRIPT, ROOT);
    return runRemoteD1File(SQL_PATH, { scriptName: SCRIPT, root: ROOT });
  }
  if (!fs.existsSync(mode.file)) throw new Error("Local SQLite database does not exist.");
  const db = new DatabaseSync(mode.file, { readOnly: true });
  try {
    return db.prepare(fs.readFileSync(SQL_PATH, "utf8")).all();
  } finally {
    db.close();
  }
}

function main() {
  try {
    const mode = parseMode(process.argv.slice(2));
    const rows = inspect(mode);
    if (!Array.isArray(rows) || rows.length !== 1) {
      throw new Error("Unexpected aggregate row count.");
    }
    const raw = rows[0]?.unsafe_selected_legacy_ids;
    // Number(null), Number(false), Number([]) and Number("  ") all yield 0.
    // These are NOT valid D1 COUNT(*) results and must never release cutover.
    const decimalText = typeof raw === "string" && /^(0|[1-9][0-9]*)$/.test(raw);
    const integerNumber = typeof raw === "number" && Number.isSafeInteger(raw);
    const value = decimalText || integerNumber ? Number(raw) : NaN;
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("Invalid aggregate count.");
    }
    // Emit only the aggregate; never log D1 row data, selected IDs or auth tokens.
    console.log(`[${SCRIPT}] unsafe_selected_legacy_ids=${value}`);
    if (value !== 0) {
      console.error(`[${SCRIPT}] BLOCKED: existing selections require reviewed remediation before cutover.`);
      return 1;
    }
    console.log(`[${SCRIPT}] PASS: all selected Active X IDs meet the SEC-713 session bound.`);
    return 0;
  } catch {
    // Error messages from D1 may contain sensitive provider details; fail closed.
    console.error(`[${SCRIPT}] BLOCKED: unable to verify selected identity safety.`);
    return 2;
  }
}

process.exitCode = main();
