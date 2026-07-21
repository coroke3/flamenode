import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [
  routeGuard,
  writeOriginGuard,
  spreadsheetGuard,
  spreadsheetRouteHandler,
  spreadsheetData,
  spreadsheetImport,
  legacyImport,
  xSearch,
] =
  await Promise.all([
    readFile(new URL("./routeGuard.ts", import.meta.url), "utf8"),
    readFile(new URL("./writeOriginGuard.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../admin/spreadsheet/guard.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../admin/spreadsheet/routeHandler.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../../../app/api/admin/spreadsheet/data/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../app/api/admin/spreadsheet/import/route.ts", import.meta.url), "utf8"),
    readFile(
      new URL(
        ["../../../app/api/admin", "import", "legacy/route.ts"].join("/"),
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../../../app/api/internal/x-users/search/route.ts", import.meta.url), "utf8"),
  ]);

test("route auth preserves temporary auth/database outages as 503", () => {
  assert.match(routeGuard, /instanceof CurrentUserUnavailableError/);
  assert.match(routeGuard, /status: 503, error: error\.code/);
  for (const route of [xSearch]) {
    assert.doesNotMatch(route, /auth\(\)\.catch/);
    assert.match(route, /requireRouteUser\(/);
  }
  assert.match(legacyImport, /instanceof CurrentUserUnavailableError/);
  assert.match(legacyImport, /return error\(cause\.code, 503\)/);
  assert.match(spreadsheetGuard, /instanceof CurrentUserUnavailableError/);
  assert.match(spreadsheetGuard, /status: 503, error: error\.code/);
});

test("all custom cookie-auth admin writes require the exact configured origin", () => {
  assert.match(writeOriginGuard, /request\.headers\.get\("Origin"\)/);
  assert.match(writeOriginGuard, /NEXT_PUBLIC_SITE_URL/);
  assert.match(writeOriginGuard, /status: 403/);
  assert.equal(
    [...spreadsheetData.matchAll(/requireSpreadsheetAdminWrite\(req\)/g)].length,
    3,
  );
  assert.match(spreadsheetImport, /requireSpreadsheetAdminWrite\(req\)/);
  assert.match(
    spreadsheetRouteHandler,
    /requireSameOriginWrite\(request\)/,
  );
  assert.match(
    spreadsheetRouteHandler,
    /requireAdminSpreadsheetWriteApi\(\)/,
  );
  assert.match(
    spreadsheetGuard,
    /requireAdminWrite\("admin_spreadsheet"\)/,
  );
  assert.match(spreadsheetGuard, /reason === "unauthenticated"/);
  assert.match(spreadsheetGuard, /reason === "db_unavailable"/);
  assert.match(spreadsheetGuard, /reason === "maintenance_mode"/);
  assert.match(spreadsheetGuard, /reason === "cost_guard_blocked"/);
  assert.match(legacyImport, /requireSameOriginWrite\(request\)/);
  assert.match(legacyImport, /requireAdminWrite\("admin_legacy_import"\)/);
  assert.doesNotMatch(legacyImport, /requireRouteUser\(/);
});
