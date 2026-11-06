import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { runTestWithTsx } from "../../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") {
        return { url: "data:text/javascript,export%20{}", shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });

  const { getSpreadsheetPageSize } = await import("./settings.ts");
  const target = await readFile(
    new URL("../../../../apps/api/src/routes/admin/spreadsheet/read.ts", import.meta.url),
    "utf8",
  );

  test("CURRENT spreadsheet page size rejects partial and unsafe env numbers", () => {
    const previous = process.env.ADMIN_SPREADSHEET_PAGE_SIZE;
    try {
      for (const raw of ["500oops", "50.5", "1e3", "+50", "-1", "Infinity", "9007199254740992", "１２"]) {
        process.env.ADMIN_SPREADSHEET_PAGE_SIZE = raw;
        assert.equal(getSpreadsheetPageSize(), 500, raw);
      }
      process.env.ADMIN_SPREADSHEET_PAGE_SIZE = " 00075 ";
      assert.equal(getSpreadsheetPageSize(), 75);
      process.env.ADMIN_SPREADSHEET_PAGE_SIZE = "9999";
      assert.equal(getSpreadsheetPageSize(), 5000);
      process.env.ADMIN_SPREADSHEET_PAGE_SIZE = "1";
      assert.equal(getSpreadsheetPageSize(), 1);
    } finally {
      if (previous === undefined) delete process.env.ADMIN_SPREADSHEET_PAGE_SIZE;
      else process.env.ADMIN_SPREADSHEET_PAGE_SIZE = previous;
    }
  });

  test("TARGET Hono spreadsheet page size requires the same complete numeric grammar", () => {
    const fnStart = target.indexOf("export function getSpreadsheetPageSize(");
    assert.ok(fnStart >= 0, "Hono page-size parser must exist");
    const functionCode = target.slice(fnStart, target.indexOf("\n}\n", fnStart) + 2);
    assert.match(functionCode, /\/\^\\d\+\$\/\.test\(trimmed\)/);
    assert.match(functionCode, /Number\.isSafeInteger\(n\)/);
    assert.doesNotMatch(functionCode, /Number\.parseInt\(/);
  });
}
