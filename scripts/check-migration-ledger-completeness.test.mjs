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

test("different owner MIGs claiming overlapping families fail for an uncovered source", () => {
  const file = "src/lib/video/private/secret.ts";
  const parent = "src/lib/video/**";
  const child = "src/lib/video/private/**";
  const conflicting = matrix([], [parent, child]).replace(familyRow(child), familyRow(child, "MIG-0619"));
  const errors = validateLedgerCompleteness({ matrix: conflicting, status, trackedFiles: [file] });
  assert.equal(errors.length, 1, errors.join("\n"));
  assert.match(errors[0], /ambiguous family ownership for src\/lib\/video\/private\/secret\.ts/);
  assert.match(errors[0], /src\/lib\/video\/\*\* \(MIG-0501\)/);
  assert.match(errors[0], /src\/lib\/video\/private\/\*\* \(MIG-0619\)/);
});

test("explicit exact file rows override ambiguous family owners", () => {
  const file = "src/lib/video/private/secret.ts";
  const child = "src/lib/video/private/**";
  const conflicting = matrix([file], ["src/lib/video/**", child])
    .replace(familyRow(child), familyRow(child, "MIG-0619"));
  assert.deepEqual(validateLedgerCompleteness({ matrix: conflicting, status, trackedFiles: [file] }), []);
});

test("nested families with one owner and adjacent prefixes do not false-positive", () => {
  assert.deepEqual(run([], ["src/lib/video/**", "src/lib/video/private/**"], [
    "src/lib/video/private/secret.ts",
  ]), []);
  assert.deepEqual(run([], ["src/lib/video/**", "src/lib/videos/**"], [
    "src/lib/video/file.ts",
    "src/lib/videos/file.ts",
  ]), []);
});


test("family table rejects corrupted path delimiters instead of silently omitting a row", () => {
  const family = "src/lib/video/private/**";
  const valid = matrix([], [family]);
  const originalCell = "| " + B + family + B + " |";
  assert.deepEqual(parseFamilyRows(valid).errors, []);
  for (const damaged of [
    valid.replace(originalCell, B + family + B + " |"), // no opening pipe
    valid.replace(originalCell, family + " |"), // no pipe or backticks
    valid.replace(originalCell, "| " + family + " |"), // missing backticks
    valid.replace(originalCell, "| " + B + family + " |"), // unmatched backtick
    valid.replace("| NOT_STARTED |", "| NOT_STARTED"), // missing trailing pipe
  ]) {
    assert.match(parseFamilyRows(damaged).errors.join("\n"), /malformed family row|invalid family path cell/);
  }
});

test("family table rejects malformed separator, missing cells, and unknown state", () => {
  const family = "src/lib/video/**";
  const valid = matrix([], [family]);
  const familyHeader = "| Family | Kind | Owner | Disp | State |";
  const familySeparator = "| --- | --- | --- | --- | --- |";
  assert.match(parseFamilyRows(valid.replace(
    familyHeader + "\n" + familySeparator,
    familyHeader + "\n| -- | --- | --- | --- | --- |",
  )).errors.join("\n"), /invalid family table separator/);
  assert.match(parseFamilyRows(valid.replace(
    familyRow(family), "| " + B + family + B + " | HELPER | MIG-0501 | NOT_STARTED |",
  )).errors.join("\n"), /4 columns, expected 5/);
  assert.match(parseFamilyRows(valid.replace("| NOT_STARTED |", "| NOT_STRTED |")).errors.join("\n"), /invalid family state/);
  assert.match(parseFamilyRows(valid.replace(familyHeader, "| Broken | Kind | Owner | Disp | State |")).errors.join("\n"), /missing family table header/);
});

test("malformed overlapping family cannot suppress ambiguous owner detection silently", () => {
  const parent = "src/lib/video/**";
  const child = "src/lib/video/private/**";
  const valid = matrix([], [parent, child]).replace(familyRow(child), familyRow(child, "MIG-0619"));
  const broken = valid.replace("| " + B + child + B + " |", "| " + child + " |");
  const errors = validateLedgerCompleteness({
    matrix: broken, status, trackedFiles: ["src/lib/video/private/secret.ts"],
  });
  assert.match(errors.join("\n"), /invalid family path cell/);
});

test("P2 regression: arbitrary damaged row prefix fails closed instead of hiding another owner", () => {
  const parent = "src/lib/video/**";
  const child = "src/lib/video/private/**";
  const valid = matrix([], [parent, child])
    .replace(familyRow(child), familyRow(child, "MIG-0619"));
  const path = "src/lib/video/private/secret.ts";
  assert.match(
    validateLedgerCompleteness({ matrix: valid, status, trackedFiles: [path] }).join("\n"),
    /ambiguous family ownership/,
  );
  for (const prefix of ["x ", "invalid-prefix ", "# "]) {
    const damaged = valid.replace(familyRow(child, "MIG-0619"), prefix + familyRow(child, "MIG-0619"));
    const errors = validateLedgerCompleteness({ matrix: damaged, status, trackedFiles: [path] });
    assert.match(errors.join("\n"), /malformed family row/, prefix);
  }
});

test("P2 regression: malformed row cannot stop validation of later family rows", () => {
  const before = "src/lib/video/private/**";
  const after = "src/lib/account/**";
  const damaged = matrix([], [before, after])
    .replace(familyRow(before), "x " + familyRow(before));
  const parsed = parseFamilyRows(damaged);
  assert.match(parsed.errors.join("\n"), /malformed family row/);
  assert.deepEqual(parsed.rows.map((r) => r.pattern), [after]);
});

test("P2 regression: family table requires one boundary and rejects moved boundaries", () => {
  const family = "src/lib/video/**";
  const valid = matrix([], [family]);
  assert.deepEqual(parseFamilyRows(valid).errors, []);
  assert.match(
    parseFamilyRows(valid.replace("**Update rule:** x", "")).errors.join("\n"),
    /exactly one Update rule boundary/,
  );
  assert.match(
    parseFamilyRows(valid.replace("**Update rule:** x", "**Update rule:** x\n**Update rule:** again")).errors.join("\n"),
    /exactly one Update rule boundary/,
  );
  const early = valid.replace(familyRow(family), "**Update rule:** x\n" + familyRow(family))
    .replace(/\n\*\*Update rule:\*\* x$/, "");
  assert.match(parseFamilyRows(early).errors.join("\n"), /family row appears after Update rule boundary/);
});


test("P2: duplicate Source families sections fail closed instead of using only the first",()=>{
 const original=matrix([],["src/lib/video/**"]);
 const duplicate=original+"\n## Source families (second copy)\n"+
  "| Family | Kind | Owner | Disp | State |\n| --- | --- | --- | --- | --- |\n"+
  familyRow("src/lib/private/**","MIG-0619")+"\n**Update rule:** second\n";
 assert.match(parseFamilyRows(duplicate).errors.join("\n"),/duplicate '## Source families' sections/);
 assert.match(validateLedgerCompleteness({matrix:duplicate,status,trackedFiles:["src/lib/private/secret.ts"]}).join("\n"),/duplicate '## Source families' sections/);
 const without=original.replace("## Source families (MIG-0622 completeness)","## Wrong section");
 assert.match(parseFamilyRows(without).errors.join("\n"),/missing '## Source families'/);
 // An example heading in a fenced code block is not a second real ledger.
 const example=original+"\n```md\n## Source families (example only)\n```\n";
 assert.deepEqual(parseFamilyRows(example).errors,[]);
});

test("P2: moved Update rule cannot hide malformed owner rows after the boundary", () => {
  const parent = "src/lib/video/**";
  const child = "src/lib/video/private/**";
  const file = "src/lib/video/private/secret.ts";
  const original = matrix([], [parent, child])
    .replace(familyRow(child), familyRow(child, "MIG-0619"));
  assert.match(
    validateLedgerCompleteness({ matrix: original, status, trackedFiles: [file] }).join("\\n"),
    /ambiguous family ownership/,
  );
  const damagedRows = [
    "x | src/lib/video/private/** | HELPER | MIG-0619 | note | NOT_STARTED |",
    "x src/lib/video/private/** HELPER MIG-0619 note NOT_STARTED",
    "x | damaged path | HELPER | MIG-0619 | note | NOT_STARTED |",
    "| src/lib/video/private/** | HELPER | MIG-0619 | note | NOT_STARTED |",
  ];
  for (const row of damagedRows) {
    const moved = original
      .replace(familyRow(child, "MIG-0619"), "**Update rule:** moved\\n" + row)
      .replace(/\\n\\*\\*Update rule:\\*\\* x$/, "");
    const parsed = parseFamilyRows(moved);
    assert.match(parsed.errors.join("\\n"), /family row appears after Update rule boundary/, row);
    const errors = validateLedgerCompleteness({ matrix: moved, status, trackedFiles: [file] });
    assert.match(errors.join("\\n"), /family row appears after Update rule boundary/, row);
  }
});
