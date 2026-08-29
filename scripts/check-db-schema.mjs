#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateDbSchema as validateBaseSchema } from "./check-db-schema.base.mjs";

export * from "./check-db-schema.base.mjs";

const FRAGMENT_IMPORT_PATTERN = /(?:from\s+|import\s*\()?["'][^"']*schema\.base(?:\.ts)?["']/;
const TABLE_PATTERN = /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*sqliteTable\s*\(\s*["']([A-Za-z0-9_]+)["']/g;
const REMOVED_TABLES = new Set([
  "audit_log_settings",
  "legacy_import_batch_items",
  "legacy_import_batches",
  "x_account_link_requests",
  "x_id_merge_requests",
  "x_id_merge_reverts",
  "x_user_icons",
  "x_user_youtube_channels",
]);

/**
 * Query-plan-only indexes that are intentionally migration-owned rather than
 * referenced by Drizzle query construction. The schema validator still treats
 * them as strict canonical objects: missing, renamed, or wrong-column indexes
 * fail the same exact manifest comparison as Drizzle-declared indexes.
 */
const OPERATIONAL_INDEX_MANIFEST = Object.freeze([
  { table: "x_users", name: "x_users_icon_url_idx", properties: ["icon_url"] },
  {
    table: "videos",
    name: "videos_creator_icon_url_idx",
    properties: ["creator_icon_url"],
  },
  { table: "events", name: "events_icon_url_idx", properties: ["icon_url"] },
  { table: "events", name: "events_img_url_idx", properties: ["img_url"] },
  {
    table: "event_groups",
    name: "event_groups_icon_url_idx",
    properties: ["icon_url"],
  },
  {
    table: "event_groups",
    name: "event_groups_img_url_idx",
    properties: ["img_url"],
  },
]);

function collectSourceFiles(dir, result = []) {
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", ".vercel", ".git"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectSourceFiles(full, result);
    else if (entry.isFile() && /\.(?:ts|tsx|mts|cts|mjs|cjs|js)$/.test(entry.name)) {
      result.push(full);
    }
  }
  return result;
}

function assertSchemaEntryPoint(root) {
  const entryPath = path.join(root, "src", "lib", "db", "schema.ts");
  const fragmentPath = path.join(root, "src", "lib", "db", "schema.base.ts");
  const canonicalPath = path.join(root, "src", "lib", "db", "schema.canonical.ts");
  if (!fs.existsSync(entryPath)) throw new Error("src/lib/db/schema.tsがありません。");
  if (!fs.existsSync(fragmentPath)) throw new Error("内部schema fragmentがありません。");
  if (!fs.existsSync(canonicalPath)) throw new Error("確定schema定義がありません。");

  const entry = fs.readFileSync(entryPath, "utf8");
  if (!/唯一の公開正本/.test(entry)) {
    throw new Error("schema.tsへ唯一の公開正本であることを明示してください。");
  }
  if (/export\s+\*\s+from\s+["']\.\/schema\.base\.ts["']/.test(entry)) {
    throw new Error("schema.tsからschema.base.tsを一括再exportできません。確定テーブルだけを明示exportしてください。");
  }
  if (!/from\s+["']\.\/schema\.base\.ts["']/.test(entry)) {
    throw new Error("schema.tsは未変更テーブルをschema.base.tsから明示exportしてください。");
  }
  if (!/from\s+["']\.\/schema\.canonical\.ts["']/.test(entry)) {
    throw new Error("schema.tsは確定テーブルをschema.canonical.tsから明示exportしてください。");
  }

  const allowed = new Set([
    path.normalize(entryPath),
    path.normalize(canonicalPath),
    path.normalize(path.join(root, "scripts", "check-db-schema.mjs")),
  ]);
  for (const sourceRoot of ["app", "src", "workers", "scripts"]) {
    for (const sourceFile of collectSourceFiles(path.join(root, sourceRoot))) {
      const normalized = path.normalize(sourceFile);
      if (allowed.has(normalized)) continue;
      const body = fs.readFileSync(sourceFile, "utf8");
      if (FRAGMENT_IMPORT_PATTERN.test(body)) {
        throw new Error(
          `${path.relative(root, sourceFile)}: schema.base.tsを直接参照できません。src/lib/db/schema.tsからimportしてください。`,
        );
      }
    }
  }
}

function readTableSegments(source) {
  const matches = [...source.matchAll(TABLE_PATTERN)];
  return matches.map((match, index) => ({
    variable: match[1],
    table: match[2],
    start: match.index,
    end: matches[index + 1]?.index ?? source.length,
  }));
}

function removeOverriddenAndRemovedTables(baseText, canonicalText) {
  const canonicalTables = new Set(readTableSegments(canonicalText).map((entry) => entry.table));
  const segments = readTableSegments(baseText);
  if (segments.length === 0) throw new Error("schema.base.tsのテーブル定義を解析できません。");

  let output = baseText.slice(0, segments[0].start);
  for (const segment of segments) {
    if (canonicalTables.has(segment.table) || REMOVED_TABLES.has(segment.table)) continue;
    output += baseText.slice(segment.start, segment.end);
  }
  return output;
}

function normalizeSchemaForManifest(schemaText) {
  return schemaText.replace(
    /\b(uniqueIndex|index)\s*\(\s*(["'][A-Za-z0-9_]+["'])\s*,\s*\)/g,
    "$1($2)",
  );
}

function injectOperationalIndexManifest(schemaText) {
  const segments = readTableSegments(schemaText);
  const declarationsByTable = new Map();
  for (const item of OPERATIONAL_INDEX_MANIFEST) {
    const declarations = declarationsByTable.get(item.table) ?? [];
    declarations.push(
      `index("${item.name}").on(${item.properties.map((property) => `t.${property}`).join(", ")})`,
    );
    declarationsByTable.set(item.table, declarations);
  }

  let output = schemaText;
  for (const segment of [...segments].sort((a, b) => b.end - a.end)) {
    const declarations = declarationsByTable.get(segment.table);
    if (!declarations?.length) continue;
    output =
      output.slice(0, segment.end) +
      `\n// migration-owned operational index manifest\n${declarations.join("\n")}\n` +
      output.slice(segment.end);
    declarationsByTable.delete(segment.table);
  }
  if (declarationsByTable.size > 0) {
    throw new Error(
      `operational index table missing from canonical schema: ${[...declarationsByTable.keys()].join(", ")}`,
    );
  }
  return output;
}

export function validateDbSchema(root = process.cwd()) {
  assertSchemaEntryPoint(root);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "flamenode-schema-check-"));
  try {
    fs.cpSync(path.join(root, "migrations"), path.join(tempRoot, "migrations"), {
      recursive: true,
    });
    const tempDbDir = path.join(tempRoot, "src", "lib", "db");
    fs.mkdirSync(tempDbDir, { recursive: true });

    const fragmentText = fs.readFileSync(
      path.join(root, "src", "lib", "db", "schema.base.ts"),
      "utf8",
    );
    const canonicalText = normalizeSchemaForManifest(
      fs.readFileSync(
        path.join(root, "src", "lib", "db", "schema.canonical.ts"),
        "utf8",
      ),
    );
    const flattened = injectOperationalIndexManifest([
      removeOverriddenAndRemovedTables(fragmentText, canonicalText),
      "\n// ===== schema.canonical.ts final definitions =====\n",
      canonicalText,
    ].join("\n"));
    fs.writeFileSync(path.join(tempDbDir, "schema.ts"), flattened, "utf8");
    return validateBaseSchema(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  try {
    const result = validateDbSchema(process.cwd());
    if (result.tableCount !== 46 || result.columnCount !== 474) {
      throw new Error(
        `正本件数不一致: expected=46 tables/474 columns actual=${result.tableCount} tables/${result.columnCount} columns`,
      );
    }
    console.log(
      `[check:db-schema] OK: schema.ts is the sole public entrypoint; ${result.migrations.length} migrations, ` +
        `${result.tableCount} tables, ${result.columnCount} columns, ${result.indexCount} indexes, ` +
        `${result.foreignKeyCount} foreign keys, ${result.checkCount} checks.`,
    );
  } catch (error) {
    console.error(
      `[check:db-schema] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
