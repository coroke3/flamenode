#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateDbSchema as validateBaseSchema } from "./check-db-schema.base.mjs";

export * from "./check-db-schema.base.mjs";

/**
 * schema.base.ts と schema.ts overlay を平坦化した一時schemaで、
 * active migrationとの完全一致を検査する。
 */
export function validateDbSchema(root = process.cwd()) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "flamenode-schema-check-"));
  try {
    fs.cpSync(path.join(root, "migrations"), path.join(tempRoot, "migrations"), {
      recursive: true,
    });
    const tempDbDir = path.join(tempRoot, "src", "lib", "db");
    fs.mkdirSync(tempDbDir, { recursive: true });

    const baseSchemaPath = path.join(root, "src", "lib", "db", "schema.base.ts");
    const overlaySchemaPath = path.join(root, "src", "lib", "db", "schema.ts");
    if (!fs.existsSync(baseSchemaPath)) {
      throw new Error("schema.base.tsがありません。");
    }

    const flattened = [
      fs.readFileSync(baseSchemaPath, "utf8"),
      "\n// ===== runtime schema overlay =====\n",
      fs.readFileSync(overlaySchemaPath, "utf8"),
    ].join("\n");
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
    console.log(
      `[check:db-schema] OK: ${result.migrations.length} migrations, ` +
        `${result.tableCount} tables, ${result.indexCount} indexes, ` +
        `${result.foreignKeyCount} foreign keys, ${result.checkCount} checks.`,
    );
  } catch (error) {
    console.error(
      `[check:db-schema] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
