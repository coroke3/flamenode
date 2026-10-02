import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const read = (rel) =>
  readFile(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const querySource = await read("./query.ts");
const apiTypesSource = await read("./apiTypes.ts");

function functionBody(source, name) {
  const start = source.indexOf(name);
  assert.ok(start >= 0, `${name} not found`);
  const next = source.indexOf("\nexport ", start + name.length);
  const nextFn = source.indexOf("\nfunction ", start + name.length);
  const candidates = [next, nextFn].filter((i) => i > start);
  return source.slice(start, Math.min(...candidates));
}

test("spreadsheet page query avoids full-table COUNT and uses limit + 1", () => {
  const body = functionBody(querySource, "async function queryTableRows(");
  assert.doesNotMatch(body, /COUNT\(/i);
  assert.match(body, /limit \+ 1/);
  assert.match(body, /hasMore: rows\.length > limit/);
  assert.match(body, /rows\.slice\(0, limit\)/);
});

test("spreadsheet page and export paths do not run COUNT or a second page query", () => {
  assert.doesNotMatch(querySource, /COUNT\(\*\)\s+AS\s+c\s+FROM\s+\$\{ctx\.quotedTable\}/i);
  const page = functionBody(querySource, "export async function fetchSpreadsheetPage(");
  assert.equal(page.match(/queryTableRows\(/g)?.length, 1);
  assert.doesNotMatch(page, /maxPage|total/);
  const exp = functionBody(querySource, "export async function fetchSpreadsheetExport(");
  assert.doesNotMatch(exp, /COUNT\(|total/i);
  assert.match(exp, /truncated: hasMore/);
});

test("spreadsheet page API reports hasMore instead of total counts", () => {
  assert.match(apiTypesSource, /hasMore: boolean/);
  assert.doesNotMatch(apiTypesSource, /\btotal(Pages)?\b/);
});
