#!/usr/bin/env node
/** Active migration列を空SQLiteへ適用し、schema.ts正本との一致を実行検査する。 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const BASELINE_NAME = "0000_flame_node_baseline.sql";
const VERSION = "2026-07-11-baseline-1";

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function hasSingleOuterParentheses(value) {
  if (!value.startsWith("(") || !value.endsWith(")")) return false;
  let depth = 0;
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === quote && value[index - 1] !== "\\") quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth === 0 && index < value.length - 1) return false;
  }
  return depth === 0;
}

function normalizeSqlExpression(value) {
  let normalized = value.trim();
  while (hasSingleOuterParentheses(normalized)) {
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized.replace(/\s+/g, " ").toLowerCase();
}

function normalizeActualDefault(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (/^'(?:[^']|'')*'$/.test(raw)) {
    return `string:${raw.slice(1, -1).replaceAll("''", "'")}`;
  }
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(raw)) {
    return `number:${Number(raw)}`;
  }
  return `sql:${normalizeSqlExpression(raw)}`;
}

function readExpectedDefault(columnChunk) {
  if (!/\.default\s*\(/.test(columnChunk)) {
    return { comparable: true, value: null };
  }
  const doubleQuoted = columnChunk.match(/\.default\s*\(\s*("(?:[^"\\]|\\.)*")\s*\)/);
  if (doubleQuoted) {
    return { comparable: true, value: `string:${JSON.parse(doubleQuoted[1])}` };
  }
  const singleQuoted = columnChunk.match(/\.default\s*\(\s*'((?:[^']|'')*)'\s*\)/);
  if (singleQuoted) {
    return { comparable: true, value: `string:${singleQuoted[1].replaceAll("''", "'")}` };
  }
  const numeric = columnChunk.match(/\.default\s*\(\s*(-?(?:\d+\.?\d*|\.\d+))\s*\)/);
  if (numeric) return { comparable: true, value: `number:${Number(numeric[1])}` };
  const sqlDefault = columnChunk.match(/\.default\s*\(\s*sql`([\s\S]*?)`\s*\)/);
  if (sqlDefault) {
    return { comparable: true, value: `sql:${normalizeSqlExpression(sqlDefault[1])}` };
  }
  return { comparable: false, value: null };
}

function findMatchingBrace(source, start) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}" && --depth === 0) return index;
  }
  return -1;
}

export function assertExactNames(label, expectedValues, actualValues) {
  const expected = new Set(expectedValues);
  const actual = new Set(actualValues);
  const missing = [...expected].filter((name) => !actual.has(name)).sort();
  const extra = [...actual].filter((name) => !expected.has(name)).sort();
  if (missing.length || extra.length) {
    throw new Error(
      `${label}不一致: missing=[${missing.join(", ")}] extra=[${extra.join(", ")}]`,
    );
  }
}

export function assertTableColumns(tableName, expectedColumns, actualColumns) {
  assertExactNames(
    `${tableName} columns`,
    expectedColumns.map((column) => column.name),
    actualColumns.map((column) => String(column.name)),
  );
  for (const expected of expectedColumns) {
    const actual = actualColumns.find((column) => String(column.name) === expected.name);
    const actualType = String(actual.type ?? "").toUpperCase();
    const actualNotNull = Number(actual.notnull ?? 0);
    const actualPk = Number(actual.pk ?? 0);
    if (actualType !== expected.type) {
      throw new Error(
        `${tableName}.${expected.name} type不一致: expected=${expected.type} actual=${actualType}`,
      );
    }
    if (actualNotNull !== expected.notNull) {
      throw new Error(
        `${tableName}.${expected.name} notNull不一致: expected=${expected.notNull} actual=${actualNotNull}`,
      );
    }
    if (actualPk !== expected.pk) {
      throw new Error(
        `${tableName}.${expected.name} pk順不一致: expected=${expected.pk} actual=${actualPk}`,
      );
    }
    if (expected.default.comparable) {
      const actualDefault = normalizeActualDefault(actual.dflt_value);
      if (actualDefault !== expected.default.value) {
        throw new Error(
          `${tableName}.${expected.name} default不一致: ` +
            `expected=${expected.default.value} actual=${actualDefault}`,
        );
      }
    }
  }
}

export function assertIndexDefinition(expected, actual) {
  if (Number(actual.unique) !== expected.unique) {
    throw new Error(
      `${expected.name} unique不一致: expected=${expected.unique} actual=${actual.unique}`,
    );
  }
  const actualColumns = actual.columns.map(String);
  if (JSON.stringify(actualColumns) !== JSON.stringify(expected.columns)) {
    throw new Error(
      `${expected.name} index列不一致: ` +
        `expected=[${expected.columns.join(", ")}] actual=[${actualColumns.join(", ")}]`,
    );
  }
}

function readSchemaManifest(schemaText) {
  const tableMatches = [
    ...schemaText.matchAll(
      /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*sqliteTable\s*\(\s*["']([A-Za-z0-9_]+)["']/g,
    ),
  ];
  const tables = tableMatches.map((match) => match[2]);
  const variables = new Map(tableMatches.map((match) => [match[1], match[2]]));
  const columnsByTable = new Map();
  const tableColumns = new Map();
  const indexes = [];
  const unresolvedForeignKeys = [];

  for (let index = 0; index < tableMatches.length; index += 1) {
    const match = tableMatches[index];
    const tableName = match[2];
    const segment = schemaText.slice(
      match.index,
      tableMatches[index + 1]?.index ?? schemaText.length,
    );
    const objectStart = segment.indexOf("{");
    const objectEnd = objectStart >= 0 ? findMatchingBrace(segment, objectStart) : -1;
    if (objectStart < 0 || objectEnd <= objectStart) {
      throw new Error(`schema.tsの${tableName}列定義を解析できません。`);
    }
    const objectText = segment.slice(objectStart + 1, objectEnd);
    const propertyCandidates = [
      ...objectText.matchAll(/^([ \t]+)([A-Za-z_$][\w$]*)\s*:/gm),
    ];
    const columnIndent = Math.min(
      ...propertyCandidates.map((candidate) => candidate[1].length),
    );
    const propertyMatches = propertyCandidates.filter(
      (candidate) => candidate[1].length === columnIndent,
    );
    const propertyColumns = new Map();
    const columnManifest = [];
    for (let propertyIndex = 0; propertyIndex < propertyMatches.length; propertyIndex += 1) {
      const property = propertyMatches[propertyIndex];
      const chunk = objectText.slice(
        property.index,
        propertyMatches[propertyIndex + 1]?.index ?? objectText.length,
      );
      const column = chunk.match(/(?:text|integer|real)\s*\(\s*["']([^"']+)["']/);
      if (!column) continue;
      propertyColumns.set(property[2], column[1]);
      columnManifest.push({
        property: property[2],
        name: column[1],
        type: column[0].trimStart().toLowerCase().startsWith("text")
          ? "TEXT"
          : column[0].trimStart().toLowerCase().startsWith("real")
            ? "REAL"
            : "INTEGER",
        notNull: /\.notNull\s*\(\s*\)/.test(chunk) || /\.primaryKey\s*\(/.test(chunk) ? 1 : 0,
        pk: /\.primaryKey\s*\(/.test(chunk) ? 1 : 0,
        default: readExpectedDefault(chunk),
      });
      const reference = chunk.match(
        /\.references\s*\(\s*\(\s*\)\s*(?::[^=]+)?=>\s*([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/,
      );
      if (reference) {
        const onDelete =
          chunk.match(/onDelete\s*:\s*["']([^"']+)["']/)?.[1] ?? "no action";
        unresolvedForeignKeys.push({
          fromTable: tableName,
          fromColumn: column[1],
          targetVariable: reference[1],
          targetProperty: reference[2],
          onDelete,
        });
      }
    }
    columnsByTable.set(tableName, propertyColumns);
    const compositePrimaryKey = segment.match(
      /primaryKey\s*\(\s*\{[\s\S]*?columns\s*:\s*\[([\s\S]*?)\][\s\S]*?\}\s*\)/,
    );
    if (compositePrimaryKey) {
      const properties = [
        ...compositePrimaryKey[1].matchAll(/\bt\.([A-Za-z_$][\w$]*)/g),
      ].map((primaryKey) => primaryKey[1]);
      properties.forEach((property, primaryKeyIndex) => {
        const column = columnManifest.find((candidate) => candidate.property === property);
        if (!column) throw new Error(`${tableName}の複合PK列${property}を解決できません。`);
        column.pk = primaryKeyIndex + 1;
        column.notNull = 1;
      });
    }
    tableColumns.set(tableName, columnManifest);

    for (const indexMatch of segment.matchAll(
      /\b(uniqueIndex|index)\s*\(\s*["']([A-Za-z0-9_]+)["']\s*\)\s*\.on\s*\(([\s\S]*?)\)/g,
    )) {
      const indexColumns = [...indexMatch[3].matchAll(/\bt\.([A-Za-z_$][\w$]*)/g)]
        .map((columnMatch) => propertyColumns.get(columnMatch[1]));
      if (indexColumns.some((column) => !column)) {
        throw new Error(`${tableName}のindex ${indexMatch[2]} 列を解決できません。`);
      }
      indexes.push({
        name: indexMatch[2],
        table: tableName,
        unique: indexMatch[1] === "uniqueIndex" ? 1 : 0,
        columns: indexColumns,
      });
    }
  }

  const foreignKeys = unresolvedForeignKeys.map((foreignKey) => {
    const targetTable = variables.get(foreignKey.targetVariable);
    const targetColumn = targetTable
      ? columnsByTable.get(targetTable)?.get(foreignKey.targetProperty)
      : null;
    if (!targetTable || !targetColumn) {
      throw new Error(
        `schema.ts FK参照を解決できません: ${foreignKey.fromTable}.${foreignKey.fromColumn}`,
      );
    }
    return {
      fromTable: foreignKey.fromTable,
      fromColumn: foreignKey.fromColumn,
      targetTable,
      targetColumn,
      onDelete: foreignKey.onDelete.toUpperCase(),
    };
  });

  return {
    tables: sortedUnique(tables),
    indexes,
    tableColumns,
    checks: sortedUnique(
      [...schemaText.matchAll(/\bcheck\s*\(\s*["']([A-Za-z0-9_]+)["']/g)]
        .map((match) => match[1]),
    ),
    foreignKeys,
  };
}


function executeMigration(db, migrationName, sqlText) {
  if (migrationName !== "0043_db_canonical_migration.sql") {
    db.exec(sqlText);
    return;
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(sqlText);
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw error;
  }
}

function foreignKeyKey(foreignKey) {
  return [
    foreignKey.fromTable,
    foreignKey.fromColumn,
    foreignKey.targetTable,
    foreignKey.targetColumn,
    foreignKey.onDelete.toUpperCase(),
  ].join("|");
}

export function validateDbSchema(root = process.cwd()) {
  const migrationsDir = path.join(root, "migrations");
  const schemaPath = path.join(root, "src", "lib", "db", "schema.ts");
  const historicalDir = path.join(migrationsDir, "historical");
  if (!fs.existsSync(historicalDir)) {
    throw new Error("旧migrationを保存するmigrations/historicalがありません。");
  }

  const activeFiles = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();
  if (activeFiles[0] !== BASELINE_NAME || activeFiles.length === 0) {
    throw new Error(`active migrationは${BASELINE_NAME}から開始してください。`);
  }
  const numbers = activeFiles.map((name) => {
    const match = name.match(/^(\d{4})_[a-z0-9_]+\.sql$/);
    if (!match) throw new Error(`active migration名が不正です: ${name}`);
    return Number(match[1]);
  });
  if (new Set(numbers).size !== numbers.length) {
    throw new Error(`active migration番号が重複しています: ${activeFiles.join(", ")}`);
  }

  const baselineSql = fs.readFileSync(path.join(migrationsDir, BASELINE_NAME), "utf8");
  if (!baselineSql.includes(`VALUES ('current', '${VERSION}', unixepoch())`)) {
    throw new Error(`schema meta version ${VERSION} がbaselineにありません。`);
  }
  if (/\b(?:ALTER|DROP)\s+TABLE\b/i.test(baselineSql)) {
    throw new Error("baselineにALTER/DROP TABLEを含めないでください。");
  }

  const schemaText = fs.readFileSync(schemaPath, "utf8");
  const manifest = readSchemaManifest(schemaText);
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON");
    for (const migrationName of activeFiles) {
      const sqlText = fs.readFileSync(path.join(migrationsDir, migrationName), "utf8");
      try {
        executeMigration(db, migrationName, sqlText);
      } catch (error) {
        throw new Error(
          `${migrationName} の空SQLite適用に失敗: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    db.exec("PRAGMA foreign_keys = ON");
    const foreignKeysEnabled = Number(
      db.prepare("PRAGMA foreign_keys").get()?.foreign_keys ?? 0,
    );
    if (foreignKeysEnabled !== 1) throw new Error("PRAGMA foreign_keysが有効ではありません。");
    const ignoreChecks = Number(
      db.prepare("PRAGMA ignore_check_constraints").get()?.ignore_check_constraints ?? 1,
    );
    if (ignoreChecks !== 0) throw new Error("SQLite CHECK制約が無効です。");

    const sqliteRows = db
      .prepare(
        "SELECT type, name, sql FROM sqlite_master WHERE type IN ('table', 'index') ORDER BY type, name",
      )
      .all();
    const actualTables = sqliteRows
      .filter((row) => row.type === "table" && !String(row.name).startsWith("sqlite_"))
      .map((row) => String(row.name));
    const actualIndexes = sqliteRows
      .filter((row) => row.type === "index" && !String(row.name).startsWith("sqlite_autoindex_"))
      .map((row) => String(row.name));
    assertExactNames("table manifest", manifest.tables, actualTables);
    assertExactNames(
      "index manifest",
      manifest.indexes.map((index) => index.name),
      actualIndexes,
    );

    for (const tableName of actualTables) {
      const escaped = tableName.replaceAll('"', '""');
      const actualColumns = db.prepare(`PRAGMA table_info("${escaped}")`).all();
      assertTableColumns(tableName, manifest.tableColumns.get(tableName) ?? [], actualColumns);
    }
    for (const expectedIndex of manifest.indexes) {
      const tableEscaped = expectedIndex.table.replaceAll('"', '""');
      const indexRow = db
        .prepare(`PRAGMA index_list("${tableEscaped}")`)
        .all()
        .find((row) => String(row.name) === expectedIndex.name);
      if (!indexRow) throw new Error(`${expectedIndex.name}のindex metadataがありません。`);
      const indexEscaped = expectedIndex.name.replaceAll('"', '""');
      const columns = db
        .prepare(`PRAGMA index_info("${indexEscaped}")`)
        .all()
        .sort((left, right) => Number(left.seqno) - Number(right.seqno))
        .map((row) => String(row.name));
      assertIndexDefinition(expectedIndex, { unique: indexRow.unique, columns });
    }

    const tableSql = sqliteRows
      .filter((row) => row.type === "table")
      .map((row) => String(row.sql ?? ""))
      .join("\n");
    const missingChecks = manifest.checks.filter(
      (name) => !new RegExp(`CONSTRAINT\\s+["']?${name}["']?\\s+CHECK`, "i").test(tableSql),
    );
    if (missingChecks.length) {
      throw new Error(`schema.tsのCHECKがmigrationにありません: ${missingChecks.join(", ")}`);
    }
    const actualCheckCount = (tableSql.match(/\bCHECK\s*\(/gi) ?? []).length;
    if (actualCheckCount === 0) throw new Error("active migrationにCHECK制約がありません。");

    const actualForeignKeys = [];
    for (const tableName of actualTables) {
      const escaped = tableName.replaceAll('"', '""');
      for (const row of db.prepare(`PRAGMA foreign_key_list("${escaped}")`).all()) {
        actualForeignKeys.push({
          fromTable: tableName,
          fromColumn: String(row.from),
          targetTable: String(row.table),
          targetColumn: String(row.to),
          onDelete: String(row.on_delete).toUpperCase(),
        });
      }
    }
    assertExactNames(
      "foreign key manifest",
      manifest.foreignKeys.map(foreignKeyKey),
      actualForeignKeys.map(foreignKeyKey),
    );
    const foreignKeyViolations = db.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyViolations.length) {
      throw new Error(`foreign_key_check違反: ${JSON.stringify(foreignKeyViolations)}`);
    }
    const integrityRows = db.prepare("PRAGMA integrity_check").all();
    if (
      integrityRows.length !== 1 ||
      String(integrityRows[0]?.integrity_check ?? "").toLowerCase() !== "ok"
    ) {
      throw new Error(`integrity_check失敗: ${JSON.stringify(integrityRows)}`);
    }

    return {
      migrations: activeFiles,
      tableCount: actualTables.length,
      columnCount: actualTables.reduce(
        (total, tableName) =>
          total + db.prepare(`PRAGMA table_info("${tableName.replaceAll('"', '""')}")`).all().length,
        0,
      ),
      indexCount: actualIndexes.length,
      foreignKeyCount: actualForeignKeys.length,
      checkCount: actualCheckCount,
    };
  } finally {
    db.close();
  }
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const result = validateDbSchema(process.cwd());
    console.log(
      `[check:db-schema] OK: ${result.migrations.length} migrations, ` +
        `${result.tableCount} tables, ${result.columnCount} columns, ${result.indexCount} indexes, ` +
        `${result.foreignKeyCount} foreign keys, ${result.checkCount} checks.`,
    );
  } catch (error) {
    console.error(`[check:db-schema] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
