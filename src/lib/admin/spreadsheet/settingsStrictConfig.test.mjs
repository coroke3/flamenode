import assert from "node:assert/strict";
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

  const { getSpreadsheetPageSize: getCurrentPageSize } = await import("./settings.ts");
  const { getSpreadsheetPageSize: getTargetPageSize } = await import(
    "../../../../apps/api/src/routes/admin/spreadsheet/read.ts"
  );

  test("spreadsheet page size rejects malformed config in CURRENT and TARGET", () => {
    const previous = process.env.ADMIN_SPREADSHEET_PAGE_SIZE;
    try {
      for (const raw of [
        "500oops", "50.5", "1e3", "+50", "-1", "Infinity",
        "9007199254740992", "１２", "50\n1", " 25 5 ",
      ]) {
        process.env.ADMIN_SPREADSHEET_PAGE_SIZE = raw;
        assert.equal(getCurrentPageSize(), 500, `CURRENT raw=${JSON.stringify(raw)}`);
        assert.equal(getTargetPageSize(raw), 50, `TARGET raw=${JSON.stringify(raw)}`);
      }
    } finally {
      if (previous === undefined) delete process.env.ADMIN_SPREADSHEET_PAGE_SIZE;
      else process.env.ADMIN_SPREADSHEET_PAGE_SIZE = previous;
    }
  });

  test("spreadsheet page size preserves valid decimals and runtime-specific caps", () => {
    const previous = process.env.ADMIN_SPREADSHEET_PAGE_SIZE;
    try {
      for (const [raw, current, target] of [
        [" 00075 ", 75, 50],
        ["9999", 5000, 50],
        ["1", 1, 1],
        ["0000", 500, 50],
        ["", 500, 50],
      ]) {
        process.env.ADMIN_SPREADSHEET_PAGE_SIZE = raw;
        assert.equal(getCurrentPageSize(), current, `CURRENT raw=${JSON.stringify(raw)}`);
        assert.equal(getTargetPageSize(raw), target, `TARGET raw=${JSON.stringify(raw)}`);
      }
    } finally {
      if (previous === undefined) delete process.env.ADMIN_SPREADSHEET_PAGE_SIZE;
      else process.env.ADMIN_SPREADSHEET_PAGE_SIZE = previous;
    }
  });
}
