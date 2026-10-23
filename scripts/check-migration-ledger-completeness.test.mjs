import test from "node:test";
import assert from "node:assert/strict";
import {
  validateLedgerCompleteness, parseFamilyRows, isRequiredSource, exclusionReason,
} from "./check-migration-ledger-completeness.mjs";

const B = "\x60";
const status = "| ID | Task | State | Depends on |\n| --- | --- | --- | --- |\n| MIG-0501 | static | BLOCKED | MIG-0407 |\n| MIG-0619 | edge | READY | MIG-0405 |";
const exactRow = (f, owner = "MIG-0619") => "| " + B + f + B + " | CONFIG | edge | " + owner + " | SAME | NOT_STARTED | — |";
const familyRow = (p, owner = "MIG-0501") => "| " + B + p + B + " | HELPER | " + owner + " | note | NOT_STARTED |";
const matrix = (exact, fam) => [
  "# m", "## Migration ledger",
  "| CURRENT path | Kind | L | Owner | Target | State | Ev |", "| --- | --- | --- | --- | --- | --- | --- |",
  ...exact.map((f) => exactRow(f)),
  "## Future files requiring source/target registration", "| a | b |",
  "## Source families (MIG-0622 completeness)", "| Family | Kind | Owner | Disp | State |", "| --- | --- | --- | --- | --- |",
  ...fam.map((p) => familyRow(p)),
  "**Update rule:** x",
].join("\n");
const run = (exact, fam, trackedFiles) => validateLedgerCompleteness({ matrix: matrix(exact, fam), status, trackedFiles });

test("T01 tracked file without row or family fails and names the file", () => {
  const errors = run(["middleware.ts"], [], ["middleware.ts", "next.config.mjs", "app/layout.tsx", "public/logo.png", "src/lib/seo.ts"]);
  const text = errors.join("\n");
  for (const f of ["next.config.mjs", "app/layout.tsx", "public/logo.png", "src/lib/seo.ts"]) assert.match(text, new RegExp(f.replace(".", "\\.")));
  assert.doesNotMatch(text, /middleware\.ts/);
});

test("T02 excluded files (tests, fixtures, generated) never fail", () => {
  const files = ["src/lib/a.test.mjs", "src/lib/b.spec.ts", "src/lib/auth/x.fixture.mjs", "src/components/__tests__/c.tsx", "app/.next/x.js", "scripts/anything.mjs", "migrations/0001_x.sql", "apps/api/src/index.ts"];
  assert.deepEqual(run([], [], files), []);
  for (const f of files) assert.equal(isRequiredSource(f), false, f);
  assert.equal(exclusionReason("src/lib/a.test.mjs"), "test file");
});

test("exact row or family covers; exact wins without needing family", () => {
  const files = ["workers/shared/abort.ts", "workers/shared/deep/x.ts", "middleware.ts"];
  assert.deepEqual(run(["middleware.ts"], ["workers/shared/**"], files), []);
});

test("T03 stale family and unknown owner fail", () => {
  assert.match(run([], ["workers/ghost/**"], []).join("\n"), /stale family row/);
  const bad = validateLedgerCompleteness({ matrix: matrix([], ["workers/shared/**"]).replace("MIG-0501", "MIG-9999"), status, trackedFiles: ["workers/shared/a.ts"] });
  assert.match(bad.join("\n"), /missing owner task MIG-9999/);
});

test("family pattern must be dir/**, duplicates and missing section fail", () => {
  assert.match(parseFamilyRows(matrix([], ["src/lib/*.ts"])).errors.join("\n"), /dir\/\*\*/);
  assert.match(run([], ["workers/shared/**", "workers/shared/**"], ["workers/shared/a.ts"]).join("\n"), /duplicate family row/);
  assert.match(validateLedgerCompleteness({ matrix: "## Migration ledger\n| x |\n## Future files requiring", status, trackedFiles: [] }).join("\n"), /Source families/);
});

test("required scope matches Work Order categories", () => {
  for (const f of ["middleware.ts", "next.config.mjs", "app/layout.tsx", "app/(admin)/layout.tsx", "app/robots.ts", "app/not-found.tsx", "public/_headers", "src/lib/seo.ts", "src/lib/health/x.ts", "workers/json-generator/queue.ts", "workers/shared/runJob.ts", "src/components/ui/Button.tsx", "wrangler.toml"]) assert.equal(isRequiredSource(f), true, f);
});

test("top-level directory family would pass vacuously and is rejected", () => {
  for (const p of ["app/**", "src/lib/**", "workers/**"]) {
    assert.match(parseFamilyRows(matrix([], [p])).errors.join(" "), /would cover everything/);
  }
  assert.match(run([], ["app/**"], ["app/layout.tsx"]).join(" "), /would cover everything/);
});
