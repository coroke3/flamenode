#!/usr/bin/env node
/**
 * schema.ts からactive baseline SQLを再現する開発用レンダラ。
 * 出力先へ直接書き込まない。baselineを更新する際は出力をレビューして
 * migrations/0000_flame_node_baseline.sql に反映する。
 */
import { getTableName } from "drizzle-orm";
import { SQLiteSyncDialect, getTableConfig } from "drizzle-orm/sqlite-core";
import * as schema from "../src/lib/db/schema.ts";

const dialect = new SQLiteSyncDialect();

function q(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function literal(value) {
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return `'${value.replaceAll("'", "''")}'`;
  const query = dialect.sqlToQuery(value);
  if (query.params.length > 0) {
    throw new Error("baselineのdefaultに未展開parameterがあります。");
  }
  return query.sql;
}

function stripTableQualification(sql, tableName) {
  return sql.replaceAll(`${q(tableName)}.`, "");
}

function typeFor(column) {
  if (column.columnType.includes("Integer") || column.columnType.includes("Timestamp")) {
    return "integer";
  }
  if (column.columnType.includes("Real")) return "real";
  return "text";
}

function tableEntries() {
  return Object.entries(schema)
    .flatMap(([exportName, value]) => {
      try {
        return [{ exportName, table: value, config: getTableConfig(value) }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.config.name.localeCompare(b.config.name));
}

function renderTable({ config }) {
  const tableName = config.name;
  const fragments = config.columns.map((column) => {
    const parts = [q(column.name), typeFor(column)];
    if (column.primary) parts.push("PRIMARY KEY");
    if (column.notNull) parts.push("NOT NULL");
    if (column.hasDefault) parts.push("DEFAULT", literal(column.default));
    if (column.enumValues?.length) {
      parts.push(
        `CHECK (${q(column.name)} IN (${column.enumValues.map(literal).join(", ")}))`,
      );
    }
    return parts.join(" ");
  });

  for (const key of config.primaryKeys) {
    fragments.push(`PRIMARY KEY (${key.columns.map((column) => q(column.name)).join(", ")})`);
  }
  for (const foreignKey of config.foreignKeys) {
    const ref = foreignKey.reference();
    const target = getTableName(ref.foreignTable);
    const parts = [
      `FOREIGN KEY (${ref.columns.map((column) => q(column.name)).join(", ")})`,
      `REFERENCES ${q(target)} (${ref.foreignColumns.map((column) => q(column.name)).join(", ")})`,
    ];
    if (foreignKey.onDelete) parts.push(`ON DELETE ${foreignKey.onDelete.toUpperCase()}`);
    if (foreignKey.onUpdate) parts.push(`ON UPDATE ${foreignKey.onUpdate.toUpperCase()}`);
    fragments.push(parts.join(" "));
  }
  for (const check of config.checks) {
    const query = dialect.sqlToQuery(check.value);
    if (query.params.length > 0) throw new Error(`CHECK ${check.name} にparameterがあります。`);
    fragments.push(`CONSTRAINT ${q(check.name)} CHECK (${stripTableQualification(query.sql, tableName)})`);
  }

  const statements = [
    `CREATE TABLE ${q(tableName)} (\n  ${fragments.join(",\n  ")}\n);`,
  ];
  for (const item of config.indexes) {
    const prefix = item.config.unique ? "CREATE UNIQUE INDEX" : "CREATE INDEX";
    let statement = `${prefix} ${q(item.config.name)} ON ${q(tableName)} (${item.config.columns.map((column) => q(column.name)).join(", ")})`;
    if (item.config.where) {
      const query = dialect.sqlToQuery(item.config.where);
      if (query.params.length > 0) throw new Error(`INDEX ${item.config.name} にparameterがあります。`);
      statement += ` WHERE ${stripTableQualification(query.sql, tableName)}`;
    }
    statements.push(`${statement};`);
  }
  return statements.join("\n");
}

console.log("PRAGMA foreign_keys = ON;");
for (const entry of tableEntries()) {
  console.log(`\n${renderTable(entry)}`);
}
