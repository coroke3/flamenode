import fs from "node:fs";
import path from "node:path";
import {
  expectedMigrationNames,
  runProcess,
} from "./cloudflare-production.mjs";

const SAFE_INDEX_STATEMENT =
  /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\b[\s\S]+$/i;

function normalizeMigrationName(name) {
  return String(name ?? "").trim().replace(/\.sql$/i, "");
}

function metadataValue(body, key) {
  return (
    body.match(new RegExp(`^--\\s*${key}:\\s*(.+?)\\s*$`, "mi"))?.[1]?.trim() ??
    ""
  );
}

function stripSqlComments(body) {
  return body
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "")
    .trim();
}

export function classifyAutoDeployMigration(body) {
  const type = metadataValue(body, "Type").toLowerCase();
  const dataLossRaw = metadataValue(body, "Data loss").toLowerCase();
  const dataLoss = dataLossRaw.match(/^(none|possible|intentional)\b/)?.[1] ?? dataLossRaw;
  const statements = stripSqlComments(body)
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);

  if (type !== "additive") {
    return { safe: false, reason: `Type must be additive (current: ${type || "missing"})` };
  }
  if (dataLoss !== "none") {
    return {
      safe: false,
      reason: `Data loss must be none (current: ${dataLoss || "missing"})`,
    };
  }
  if (statements.length === 0) {
    return { safe: false, reason: "migration has no executable SQL statements" };
  }
  if (!statements.every((statement) => SAFE_INDEX_STATEMENT.test(statement))) {
    return {
      safe: false,
      reason:
        "automatic production migration is restricted to CREATE INDEX IF NOT EXISTS statements",
    };
  }
  return { safe: true, reason: null };
}

function findMigrationRow(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findMigrationRow(item);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  if (Object.hasOwn(value, "migration_names")) return value;
  for (const item of Object.values(value)) {
    const found = findMigrationRow(item);
    if (found) return found;
  }
  return null;
}

export function parseAppliedMigrationNames(payload) {
  const row = findMigrationRow(payload);
  if (!row) {
    throw new Error("Remote D1 migration probe returned no migration result.");
  }
  const rawNames =
    typeof row.migration_names === "string" ? row.migration_names.split("\u001f") : [];
  return new Set(rawNames.map(normalizeMigrationName).filter(Boolean));
}

export function pendingMigrationNames(expected, applied) {
  return expected.filter((name) => !applied.has(normalizeMigrationName(name)));
}

export function inspectPendingAutoDeployMigrations(repoRoot, pending) {
  return pending.map((name) => {
    const filePath = path.join(repoRoot, "migrations", name);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return { name, safe: false, reason: "migration file is missing" };
    }
    const verdict = classifyAutoDeployMigration(fs.readFileSync(filePath, "utf8"));
    return { name, ...verdict };
  });
}

export function readRemoteAppliedMigrationNames({
  env = process.env,
  repoRoot = process.cwd(),
  webConfig,
  wranglerBin,
  run = runProcess,
} = {}) {
  const sql = [
    "SELECT",
    "(SELECT group_concat(name, char(31))",
    "FROM (SELECT name FROM d1_migrations ORDER BY id)) AS migration_names",
  ].join(" ");
  if (/\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE|PRAGMA)\b/i.test(sql)) {
    throw new Error("Internal error: D1 migration probe must remain read-only.");
  }
  const result = run({
    executable: process.execPath,
    args: [
      wranglerBin,
      "d1",
      "execute",
      "flamenode_db",
      "--remote",
      "--config",
      webConfig,
      "--command",
      sql,
      "--json",
    ],
    cwd: repoRoot,
    env,
    label: "cloudflare-deploy:d1-migration-probe",
    allowOutput: false,
  });
  let payload;
  try {
    payload = JSON.parse(String(result.stdout ?? "").trim());
  } catch {
    throw new Error("Remote D1 migration probe returned malformed JSON; deployment stopped.");
  }
  return parseAppliedMigrationNames(payload);
}

export function runSafeRemoteIndexMigrations({
  env = process.env,
  repoRoot = process.cwd(),
  webConfig,
  wranglerBin,
  run = runProcess,
  readApplied = readRemoteAppliedMigrationNames,
} = {}) {
  // Test/injected deploy fixtures may intentionally omit the repository migration tree.
  // Real production still runs the strict schema preflight immediately after this helper.
  const migrationsDir = path.join(repoRoot, "migrations");
  if (!fs.existsSync(migrationsDir)) {
    return { applied: false, pending: [], appliedNames: [] };
  }

  const expected = expectedMigrationNames(repoRoot);
  const appliedBefore = readApplied({
    env,
    repoRoot,
    webConfig,
    wranglerBin,
    run,
  });
  const pending = pendingMigrationNames(expected, appliedBefore);
  if (pending.length === 0) {
    return { applied: false, pending: [], appliedNames: [] };
  }

  const inspections = inspectPendingAutoDeployMigrations(repoRoot, pending);
  const unsafe = inspections.filter((item) => !item.safe);
  if (unsafe.length > 0) {
    const details = unsafe
      .map((item) => `${item.name}: ${item.reason}`)
      .join("; ");
    throw new Error(
      `Remote D1 has unapplied migrations that require manual review: ${details}. ` +
        'Run "npm run db:remote-apply -- --config <generated-web-config>" only after backup/review.',
    );
  }

  const migrationScript = path.join(repoRoot, "scripts", "apply-d1-migrations.mjs");
  try {
    run({
      executable: process.execPath,
      args: [migrationScript, "remote", "--config", webConfig, "--yes"],
      cwd: repoRoot,
      env,
      label: "cloudflare-deploy:d1-safe-index-migrations",
    });
  } catch (error) {
    throw new Error(
      "Automatic safe D1 index migration failed. Ensure CLOUDFLARE_API_TOKEN has D1 write/edit permission, then retry. " +
        (error instanceof Error ? error.message : String(error)),
    );
  }

  const appliedAfter = readApplied({
    env,
    repoRoot,
    webConfig,
    wranglerBin,
    run,
  });
  const remaining = pendingMigrationNames(expected, appliedAfter);
  if (remaining.length > 0) {
    throw new Error(
      `Remote D1 still has unapplied migrations after automatic safe apply: ${remaining.join(", ")}.`,
    );
  }

  return { applied: true, pending, appliedNames: pending };
}
