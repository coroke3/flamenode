import test from "node:test";
import assert from "node:assert/strict";
import { expandDependencies, parseDecisionRows, parseTaskRows, validateMigrationExecution, validateCheckpointPolicy, validateStatusTableStructure, hasValidSkipApprovalRecord } from "./check-migration-execution.mjs";

const status = `Current Task: MIG-0301
Task State: READY
| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0108 | Gate | DONE | — |
| MIG-0301 | core PoC | READY | MIG-0108 |
| MIG-0302 | read | BLOCKED | MIG-0301 |
| MIG-0308 | packages/db | BLOCKED | MIG-0302 |
| MIG-0303 | mutate | BLOCKED | MIG-0308 |
| MIG-0304 | video | BLOCKED | MIG-0303 |
| MIG-0305 | event | BLOCKED | MIG-0303 |
| MIG-0306 | users | BLOCKED | MIG-0303 |
| MIG-0307 | Gate | BLOCKED | MIG-0304..MIG-0306, MIG-0308 |
| MIG-0402 | Astro | BLOCKED | MIG-0301 |
| MIG-0405 | fence | BLOCKED | MIG-0301 |
| MIG-0406 | budget | BLOCKED | MIG-0405 |
| MIG-0605 | users api | BLOCKED | MIG-0307 |
| MIG-0701 | spa | BLOCKED | MIG-0307 |
| MIG-0702 | mutate spa | BLOCKED | MIG-0701 |
| MIG-0802 | auth | BLOCKED | MIG-0307 |
`;
const decisions = `| ID | Decision | State | Needed by |
| --- | --- | --- | --- |
| D-01 | schema | OPEN | MIG-0303 |
| D-02 | router | OPEN | MIG-0405 |
| D-03 | active x | OPEN | MIG-0605 |
| D-04 | writer | OPEN | MIG-0702 |
| D-05 | spa | PROVISIONAL | MIG-0701 |
| D-06 | scale | OPEN | MIG-0406 |
| D-07 | auth | PROVISIONAL | MIG-0802 |
| D-08 | mock | BLOCKED_ON_USER | MIG-0200 |
| D-09 | background 1102 | DECIDED | MIG-0409 |
`;
const routing = "Phase 8まで /api/auth/* を旧Workerに維持。/api/* 一括切替は禁止。 /_ops_assets/* /_personal_assets/*";
const vite = 'export default defineConfig({base: "/", build: {assetsDir: "_personal_assets"}});';
const api = "CURRENT の `/api/*` パス構造";

function run(overrides = {}) {
  return validateMigrationExecution({ statusText: status, decisionsText: decisions, routingText: routing, viteText: vite, apiSpecText: api, ...overrides });
}

test("parse status task and decision inventory", () => {
  assert.equal(parseTaskRows(status).get("MIG-0301").state, "READY");
  assert.equal(parseDecisionRows(decisions).get("D-01"), "OPEN");
  assert.deepEqual(expandDependencies("MIG-0304..MIG-0306"), ["MIG-0304", "MIG-0305", "MIG-0306"]);
});

test("malformed STATUS task rows fail closed rather than disappearing from dependency checks", () => {
  const row = "| MIG-0301 | core PoC | READY | MIG-0108 |";
  for (const malformed of [
    "| MIG-0301 | core PoC | READY | MIG-0108",
    "| MIG-0301 | core PoC | READY | |",
    "| MIG-0301 | core PoC | READY | MIG-0108 | extra | extra |",
    "| MIG-0301 | core PoC | READY | MIG-0108 ||",
  ]) {
    const changed = status.replace(row, malformed);
    assert.throws(() => parseTaskRows(changed), /malformed task row: MIG-0301/);
    assert.match(run({ statusText: changed }).join("\n"), /invalid STATUS task ledger: malformed task row: MIG-0301/);
  }
  assert.deepEqual(run(), []);
});

test("missing leading pipe, MIG separator, or noncanonical indentation fails closed", () => {
  const row = "| MIG-0301 | core PoC | READY | MIG-0108 |";
  for (const malformed of [
    "MIG-0301 | core PoC | READY | MIG-0108 |",
    " | MIG-0301 | core PoC | READY | MIG-0108 |",
    "\t| MIG-0301 | core PoC | READY | MIG-0108 |",
    "| MIG-0301 core PoC | READY | MIG-0108 |",
  ]) {
    const changed = status.replace(row, malformed);
    assert.throws(() => parseTaskRows(changed), /malformed task row: MIG-0301/);
    assert.match(run({ statusText: changed }).join("\n"),
      /invalid STATUS task ledger: malformed task row: MIG-0301/);
  }
});

test("task rows missing every pipe fail closed within STATUS task tables", () => {
  const row = "| MIG-0301 | core PoC | READY | MIG-0108 |";
  for (const malformed of [
    "MIG-0301 core PoC READY MIG-0108",
    "MIG-0301",
    "  MIG-0301 core PoC READY MIG-0108",
    "| MIG-0301 core PoC READY MIG-0108",
  ]) {
    const changed = status.replace(row, malformed);
    assert.throws(() => parseTaskRows(changed), /malformed task row: MIG-0301/, malformed);
    assert.match(run({ statusText: changed }).join("\n"),
      /invalid STATUS task ledger: malformed task row: MIG-0301/, malformed);
  }
  const prose = status + "\n## Ordinary section\nMIG-0301 core PoC READY MIG-0108\n";
  assert.deepEqual(run({ statusText: prose }), []);
});


test("invalid or missing task IDs inside STATUS tables fail closed", () => {
  const row = "| MIG-0301 | core PoC | READY | MIG-0108 |";
  for (const malformed of [
    "| MIG-030A | core PoC | READY | MIG-0108 |",
    "| MIG-03012 | core PoC | READY | MIG-0108 |",
    "| | core PoC | READY | MIG-0108 |",
    "| not-a-task | core PoC | READY | MIG-0108 |",
  ]) {
    const changed = status.replace(row, malformed);
    assert.throws(() => parseTaskRows(changed), /malformed task row:/, malformed);
    assert.match(run({ statusText: changed }).join("\n"),
      /invalid STATUS task ledger: malformed task row:/, malformed);
  }
  // A delimiter row and prose outside the table remain valid.
  assert.deepEqual(run(), []);
  assert.deepEqual(run({ statusText: status + "\n| not-a-task | prose only |\n" }), []);
});

test("pipe-free STATUS task rows with invalid MIG IDs fail closed", () => {
  const row = "| MIG-0301 | core PoC | READY | MIG-0108 |";
  for (const malformed of [
    "MIG-030A core PoC READY MIG-0108",
    "MIG-03012 core PoC READY MIG-0108",
    "MIG-03A1 core PoC READY MIG-0108",
    "MIG-030_ core PoC READY MIG-0108",
  ]) {
    const changed = status.replace(row, malformed);
    assert.throws(() => parseTaskRows(changed), /malformed task row: MIG-/,
      "corrupted pipe-free row must not disappear: " + malformed);
    assert.match(run({ statusText: changed }).join("\n"),
      /invalid STATUS task ledger: malformed task row: MIG-/);
  }
  // A section boundary and regular prose outside the task table are unaffected.
  assert.deepEqual(run({ statusText: status + "\n## Details\nMIG-030A is a prose example.\n" }), []);
});

test("missing ID plus lost pipe markers fails closed inside STATUS task tables", () => {
  const row = "| MIG-0301 | core PoC | READY | MIG-0108 |";
  for (const malformed of [
    "core PoC READY MIG-0108",
    "0301 core PoC READY MIG-0108",
    "core PoC | READY | MIG-0108 |",
  ]) {
    const changed = status.replace(row, malformed);
    assert.throws(() => parseTaskRows(changed), /malformed task row: <missing ID>/,
      "broken table row must not become prose: " + malformed);
    assert.match(run({ statusText: changed }).join("\n"),
      /invalid STATUS task ledger: malformed task row: <missing ID>/);
  }
  const validHeader = [
    "| ID | Task | State | Depends on |",
    "| --- | --- | --- | --- |",
    row,
  ].join("\n");
  const expected = ["MIG-0301"];
  assert.deepEqual([...parseTaskRows(validHeader + "\n\nordinary prose").keys()], expected);
  assert.deepEqual([...parseTaskRows(validHeader + "\n## Next section\nordinary prose").keys()], expected);
});

test("STATUS task table separators must be complete, not merely start with dashes", () => {
  const canonical = "| --- | --- | --- | --- |";
  for (const broken of [
    "| --- | --- | text | --- |",
    "| --- |",
    "| --- | --- | --- | ---",
    "| --- | --- | --- | --- | extra |",
  ]) {
    const corrupted = status.replace(canonical, broken);
    assert.throws(() => parseTaskRows(corrupted), /malformed task row: separator/, broken);
    assert.match(
      run({ statusText: corrupted }).join("\n"),
      /invalid STATUS task ledger: malformed task row: separator/,
      broken,
    );
  }
  assert.deepEqual(run(), []);
});

test("ordinary MIG prose outside task tables is not treated as a broken task row", () => {
  const appended = status + "\nMIG-0301 is discussed in prose.\nMIG-0302 | paragraph reference, not a row.\n";
  assert.equal(parseTaskRows(appended).size, parseTaskRows(status).size);
  assert.deepEqual(run({ statusText: appended }), []);
});

test("Phase 0 acceptance column remains valid while malformed acceptance fails", () => {
  const withAcceptance = status + "\n| ID | Task | State | Depends on | Acceptance |\n| --- | --- | --- | --- | --- |\n| MIG-0001 | base inventory | DONE | — | complete |\n";
  assert.equal(parseTaskRows(withAcceptance).get("MIG-0001").state, "DONE");
  assert.deepEqual(run({ statusText: withAcceptance }), []);
  assert.match(run({ statusText: withAcceptance.replace("| complete |", "| |") }).join("\n"), /malformed task row: MIG-0001/);
});

test("unrelated pure MIG-0301 can run before decisions", () => {
  assert.deepEqual(run(), []);
});

test("duplicate decision IDs fail closed instead of replacing an OPEN gate with DECIDED", () => {
  const original = "| D-01 | schema | OPEN | MIG-0303 |";
  const approved = "| D-01 | schema | DECIDED | MIG-0303 |";
  for (const duplicate of [
    decisions.replace(original, original + "\n" + approved),
    decisions.replace(original, approved + "\n" + original),
    decisions.replace(original, original + "\n" + original),
  ]) {
    assert.throws(() => parseDecisionRows(duplicate), /duplicate decision row: D-01/);
    assert.match(run({ decisionsText: duplicate }).join("\n"),
      /invalid decision ledger: duplicate decision row: D-01/);
  }
  // A clean ledger is still accepted, including a genuine single DECIDED row.
  assert.equal(parseDecisionRows(decisions).get("D-01"), "OPEN");
  assert.equal(parseDecisionRows(decisions.replace(original, approved)).get("D-01"), "DECIDED");
  assert.deepEqual(run(), []);
});



test("adapter checkpoint marker cannot hide contradictory STATUS write rules", () => {
  const valid = "Checkpoint policy: WORK_ITEM_ONLY. Save work-items/MIG-XXXX.md every wake; reconcile STATUS at merge integration.";
  assert.deepEqual(validateCheckpointPolicy({adapter:valid}), []);
  for (const stale of ["`STATUS.md`が唯一のtask進捗正本", "branch STATUSのcheckpointから再開", "Finish as DONE, REVIEW, or BLOCKED, update `STATUS.md`", "persist STATUS + ledgers/matrices"]) {
    assert.match(validateCheckpointPolicy({adapter:valid+"\n"+stale}).join("\n"), /conflicting per-wake STATUS/);
  }
});

test("wake report state choices must allow a healthy incomplete checkpoint", () => {
  const policy = "Checkpoint policy: WORK_ITEM_ONLY. Save work-items/MIG-XXXX.md on the owning PR.";
  for (const declaration of [
    "State: DONE | REVIEW | BLOCKED",
    "Status: REVIEW / BLOCKED / DONE",
    "- 終了はDONE/REVIEW/BLOCKED（work-itemに証跡を残す）",
  ]) {
    assert.match(validateCheckpointPolicy({ report: policy + "\n" + declaration }).join("\n"), /missing IN_PROGRESS/);
  }
  assert.deepEqual(validateCheckpointPolicy({ report: policy + "\nState: IN_PROGRESS | REVIEW | BLOCKED | DONE" }), []);
  assert.deepEqual(validateCheckpointPolicy({ report: policy + "\nState: READY -> IN_PROGRESS" }), []);
});

test("requires D-01 before MIG-0303 begins", () => {
  const changed = status.replace("| MIG-0302 | read | BLOCKED | MIG-0301 |", "| MIG-0302 | read | DONE | MIG-0301 |")
                        .replace("| MIG-0301 | core PoC | READY | MIG-0108 |", "| MIG-0301 | core PoC | DONE | MIG-0108 |")
                        .replace("| MIG-0308 | packages/db | BLOCKED | MIG-0302 |", "| MIG-0308 | packages/db | DONE | MIG-0302 |")
                        .replace("| MIG-0303 | mutate | BLOCKED | MIG-0308 |", "| MIG-0303 | mutate | READY | MIG-0308 |")
                        .replace("Current Task: MIG-0301", "Current Task: MIG-0303");
  assert.match(run({statusText: changed}).join("\n"), /D-01 is DECIDED/);
});

test("rejects unfinished dependencies for a READY task", () => {
  const changed = status.replace("| MIG-0302 | read | BLOCKED | MIG-0301 |", "| MIG-0302 | read | READY | MIG-0301 |");
  assert.match(run({statusText: changed}).join("\n"), /unfinished dependency/);
});

test("rejects SPA base mismatch", () => {
  assert.match(run({viteText:'base: "/dashboard/"'}).join("\n"), /base '\/'/);
});

test("rejects catch-all routing or auth omission", () => {
  assert.match(run({routingText:"/api/* -> flamenode-api"}).join("\n"), /auth/);
});

test("requires known decision references", () => {
  assert.match(run({decisionsText: decisions.replace("| D-01 | schema | OPEN | MIG-0303 |", "")}).join("\n"), /missing decision/);
});

test("reject missing packages/db migration task", () => {
  const changed = status.replace("| MIG-0308 | packages/db | BLOCKED | MIG-0302 |\n", "");
  assert.match(run({ statusText: changed }).join("\n"), /MIG-0308 packages\/db/);
});

test("reject missing separate private asset namespace", () => {
  assert.match(run({ viteText:'base: "/", assetsDir: "_app_assets"' }).join("\n"), /_personal_assets/);
  assert.match(run({ routingText: "Phase 8まで /api/auth/* を旧Workerに維持。/api/* 一括切替は禁止。" }).join("\n"), /2-SPA asset/);
});

test("reject premature D-08 completion while HTML is not registered", () => {
  const fakeDecisions = decisions.replace("D-08 | mock | BLOCKED_ON_USER", "D-08 | mock | DECIDED");
  assert.match(run({ decisionsText: fakeDecisions, uiReferenceText: "# UI\n> Status: `PENDING_HTML`" }).join("\n"), /mock registration/);
});

test("fan-out is explicitly checked against owner links", () => {
  assert.match(run({activeXText:"active x link_role='manager' fan-out"}).join("\n"), /approved owner X fan-out/);
});

test("BLOCKED task referencing nonexistent prerequisite is invalid immediately", () => {
  const changed = status.replace("| MIG-0302 | read | BLOCKED | MIG-0301 |", "| MIG-0302 | read | BLOCKED | MIG-9999 |");
  assert.match(run({statusText:changed}).join("\n"), /MIG-0302 missing dependency MIG-9999/);
});

test("cyclic future tasks cannot silently deadlock", () => {
  const changed = status.replace("| MIG-0302 | read | BLOCKED | MIG-0301 |", "| MIG-0302 | read | BLOCKED | MIG-0303 |");
  assert.match(run({statusText:changed}).join("\n"), /dependency cycle/);
});

test("duplicated MIG rows must be rejected instead of shadowed", () => {
  const changed = status.replace("| MIG-0302 | read | BLOCKED | MIG-0301 |", "| MIG-0302 | read | BLOCKED | MIG-0301 |\n| MIG-0302 | duplicate | BLOCKED | MIG-0301 |");
  assert.match(run({statusText:changed}).join("\n"), /duplicate task row/);
});

test("SKIPPED task cannot bypass dependent gate without independent approval", () => {
  const changed = status.replace("| MIG-0301 | core PoC | READY | MIG-0108 |", "| MIG-0301 | core PoC | SKIPPED | MIG-0108 |");
  assert.match(run({statusText:changed}).join("\n"),/SKIP_APPROVAL/);
});


const performanceDagStatus = status
 .replace("| MIG-0402 | Astro | BLOCKED | MIG-0301 |","| MIG-0402 | Astro | BLOCKED | MIG-0206, MIG-0401 |")
 .replace("| MIG-0405 | fence | BLOCKED | MIG-0301 |","| MIG-0405 | fence | BLOCKED | MIG-0404 |")
 + "| MIG-0105 | Astro skeleton | DONE | MIG-0108 |\n"
 + "| MIG-0206 | Visual Gate | BLOCKED | MIG-0108 |\n"
 + "| MIG-0401 | snapshot | READY | MIG-0105 |\n"
 + "| MIG-0403 | visual representatives | BLOCKED | MIG-0402, MIG-0404 |\n"
 + "| MIG-0404 | route manifest | BLOCKED | MIG-0401 |\n"
 + "| MIG-0409 | build-time data | BLOCKED | MIG-0404 |\n"
 + "| MIG-0410 | build scheduler | BLOCKED | MIG-0409 |\n"
 + "| MIG-0411 | page regeneration | BLOCKED | MIG-0405, MIG-0409 |\n"
 + "| MIG-0407 | Phase4 Gate | BLOCKED | MIG-0403, MIG-0406 |\n";
test("1102 performance PoC can be READY while visual D-08 is BLOCKED", () => {
 const actual=performanceDagStatus.replace("| MIG-0406 | budget | BLOCKED | MIG-0405 |","| MIG-0406 | budget | BLOCKED | MIG-0405 |");
 assert.deepEqual(run({statusText:actual}),[]);
});
test("performance DAG cannot be put behind unfinished visual routes", () => {
 const changed=performanceDagStatus.replace("| MIG-0404 | route manifest | BLOCKED | MIG-0401 |","| MIG-0404 | route manifest | BLOCKED | MIG-0403 |");
 assert.match(run({statusText:changed}).join("\n"),/MIG-0404 performance\/visual DAG/);
});
test("real performance PoC may become BLOCKED for a discovered blocker without falsifying readiness", () => {
 const changed=performanceDagStatus.replace("| MIG-0401 | snapshot | READY | MIG-0105 |","| MIG-0401 | snapshot | BLOCKED | MIG-0105 |");
 assert.deepEqual(run({statusText:changed}),[]);
});
test("0401 cannot silently acquire the visual HTML dependency",()=>{
 const changed=performanceDagStatus.replace("| MIG-0401 | snapshot | READY | MIG-0105 |","| MIG-0401 | snapshot | BLOCKED | MIG-0206 |");
 assert.match(run({statusText:changed}).join("\n"),/MIG-0401 performance\/visual DAG/);
});
test("Phase 4 Gate depends on 0403 and 0406 only (owner decision 2026-10-23)",()=>{
 const changed=performanceDagStatus.replace("| MIG-0407 | Phase4 Gate | BLOCKED | MIG-0403, MIG-0406 |","| MIG-0407 | Phase4 Gate | BLOCKED | MIG-0403, MIG-0406, MIG-0410, MIG-0411 |");
 assert.match(run({statusText:changed}).join("\n"),/MIG-0407 performance\/visual DAG/);
});

test("STATUS task table header and delimiter must be present and canonical", () => {
  const header = "| ID | Task | State | Depends on |\n";
  const delimiter = "| --- | --- | --- | --- |\n";
  assert.deepEqual(validateStatusTableStructure(status), []);
  assert.deepEqual(run(), []);
  const cases = {
    "deleted header": [header, "", /outside a recognized task table|not followed by delimiter/],
    "altered header column": [header, "| ID | Title | State | Depends on |\n", /non-canonical task table header/],
    "altered ID column": [header, "| Id2 | Task | State | Depends on |\n", /outside a recognized task table/],
    "deleted delimiter": [delimiter, "", /not followed by delimiter row/],
  };
  for (const [name, [from, to, pattern]] of Object.entries(cases)) {
    const changed = status.replace(from, to);
    assert.notEqual(changed, status, name);
    assert.match(validateStatusTableStructure(changed).join("\n"), pattern, name);
    assert.match(run({ statusText: changed }).join("\n"), /invalid STATUS task ledger/, name);
  }
  // Phase 0 tables with an Acceptance column stay valid.
  const withAcceptance = "| ID | Task | State | Depends on | Acceptance |\n| --- | --- | --- | --- | --- |\n| MIG-0101 | t | DONE | — | ok |\n";
  assert.deepEqual(validateStatusTableStructure(withAcceptance), []);
});

test("STATUS table width, blockquote, repeated delimiter and code fence handling", () => {
  const H = "| ID | Task | State | Depends on |";
  const D = "| --- | --- | --- | --- |";
  const R = "| MIG-0301 | core PoC | READY | MIG-0108 |";
  const struct = (text) => validateStatusTableStructure(text).join("\n");
  assert.match(struct([H, "| --- | --- | --- | --- | --- |", R].join("\n")), /delimiter row column count/);
  assert.match(struct([H, "| --- | --- | --- |", R].join("\n")), /delimiter row column count/);
  const acceptance = "| ID | Task | State | Depends on | Acceptance |";
  assert.match(struct([acceptance, D, "| MIG-0001 | t | DONE | — | ok |"].join("\n")), /delimiter row column count/);
  assert.match(struct([H, D, "| MIG-0301 | a | READY | b | c |"].join("\n")), /row column count differs/);
  assert.match(struct([acceptance, "| --- | --- | --- | --- | --- |", R].join("\n")), /row column count differs/);
  assert.match(struct([H, D, R, D, R].join("\n")), /unexpected delimiter row/);
  assert.match(struct(["> " + H, "> " + D, "> " + R].join("\n")), /blockquote/);
  const fenced = ["```", "| ID | Task |", R, "```", "", H, D, R].join("\n");
  assert.equal(struct(fenced), "");
  assert.equal(parseTaskRows(fenced).size, 1);
  const changed = status.replace(D, "| --- | --- | --- | --- | --- |");
  assert.match(run({ statusText: changed }).join("\n"), /invalid STATUS task ledger/);
});


test("duplicate visible MIG IDs fail closed in parser, structure validator and execution gate",()=>{
 const first="| MIG-0301 | core PoC | READY | MIG-0108 |";
 for (const [stateA,stateB] of [["BLOCKED","DONE"],["DONE","BLOCKED"]]) {
  const initial=first.replace("| READY |","| "+stateA+" |");
  const duplicate=first.replace("| READY |","| "+stateB+" |");
  const altered=status.replace(first,initial+"\n"+duplicate);
  assert.throws(()=>parseTaskRows(altered),/duplicate task row: MIG-0301 at STATUS line \d+/);
  assert.match(validateStatusTableStructure(altered).join("\n"),/duplicate task row: MIG-0301/);
  assert.match(run({statusText:altered}).join("\n"),/duplicate task row: MIG-0301/);
 }
 const later=status+"\n## Next phase\n| ID | Task | State | Depends on |\n| --- | --- | --- | --- |\n| MIG-0301 | fake later | DONE | — |\n";
 assert.throws(()=>parseTaskRows(later),/duplicate task row: MIG-0301/);
 assert.match(validateStatusTableStructure(later).join("\n"),/duplicate task row: MIG-0301/);
 assert.equal(parseTaskRows(status).size,new Set([...parseTaskRows(status).keys()]).size);
});

test("closed HTML comments cannot supply fake DONE dependencies or task-table headers",()=>{
 const fakeHeader="| ID | Task | State | Depends on |\n| --- | --- | --- | --- |";
 const fakeDone="| MIG-9999 | example only | DONE | — |";
 const before=status.replace("| MIG-0301 | core PoC | READY | MIG-0108 |",
  "| MIG-0301 | core PoC | READY | MIG-9999 |");
 const commented=before+"\n<!--\n"+fakeHeader+"\n"+fakeDone+"\n\n-->\n";
 assert.equal(parseTaskRows(commented).has("MIG-9999"),false);
 assert.deepEqual(validateStatusTableStructure(commented),[]);
 assert.match(run({statusText:commented}).join("\n"),/missing dependency MIG-9999/);
 const normal=status+"\n<!--\n"+fakeHeader+"\n"+fakeDone+"\n-->\n";
 assert.deepEqual(run({statusText:normal}),[]);
 const inline=status+"\n<!-- "+fakeDone+" -->\n";
 assert.deepEqual(run({statusText:inline}),[]);
});

test("real task table after HTML comment is parsed, fenced comment markers remain examples",()=>{
 const header="| ID | Task | State | Depends on |";
 const separator="| --- | --- | --- | --- |";
 const actual="| MIG-0301 | real | READY | MIG-0108 |";
 const doc=[
  "```md",
  "<!-- not a real comment opener inside a code fence",
  "```",
  "<!--",header,separator,"| MIG-9999 | fake | DONE | — |","-->",
  header,separator,actual,
 ].join("\n");
 assert.deepEqual([...parseTaskRows(doc).keys()],["MIG-0301"]);
 assert.deepEqual(validateStatusTableStructure(doc),[]);
 const inlineCode="`<!--`\n"+header+"\n"+separator+"\n"+actual+"\n";
 assert.deepEqual([...parseTaskRows(inlineCode).keys()],["MIG-0301"]);
 // An unclosed comment cannot reveal apparent rows as completed prerequisites.
 const unclosed=header+"\n"+separator+"\n"+actual+"\n<!--\n"+
  header+"\n"+separator+"\n| MIG-9999 | fake | DONE | — |\n";
 assert.deepEqual([...parseTaskRows(unclosed).keys()],["MIG-0301"]);
});


test("mismatched backtick runs do not conceal real HTML comment openers",()=>{
 const H="| ID | Task | State | Depends on |";
 const D="| --- | --- | --- | --- |";
 const fake="| MIG-9999 | fake | DONE | — |";
 const doc="\`\`<!--\`\`\`\`\n"+H+"\n"+D+"\n"+fake+"\n-->\n"+
  H+"\n"+D+"\n| MIG-0301 | real | READY | MIG-0108 |\n";
 assert.deepEqual([...parseTaskRows(doc).keys()],["MIG-0301"]);
 assert.deepEqual(validateStatusTableStructure(doc),[]);
});

test("SKIP_APPROVAL structure rejects placeholder, fenced and commented approval references", () => {
 const good="SKIP_APPROVAL: MIG-0105 | PR#404 | APPROVAL=https://github.com/coroke3/flamenode/pull/404#issuecomment-123 | ALTERNATIVE=MIG-0108";
 const withDoneAlternative = "| ID | Task | State | Depends on |\n| --- | --- | --- | --- |\n| MIG-0108 | completed alternative | DONE | — |\n"+good;
 assert.equal(hasValidSkipApprovalRecord(good,"MIG-0105"),false,
   "a bare approval note cannot invent an absent alternate task");
 assert.equal(hasValidSkipApprovalRecord(withDoneAlternative,"MIG-0105"),true);
 assert.equal(hasValidSkipApprovalRecord(good,"MIG-0104"),false);
 for(const bad of [
  withDoneAlternative.replace("PR#404","PR#405"),
  withDoneAlternative.replace("pull/404","pull/405"),
  withDoneAlternative.replace("github.com/coroke3/flamenode","github.com/other-owner/other-repo"),
  withDoneAlternative.replace("https://github.com/coroke3/flamenode/pull/404#issuecomment-123","not-approved"),
  withDoneAlternative.replace("ALTERNATIVE=MIG-0108","ALTERNATIVE=none"),
  withDoneAlternative.replace("ALTERNATIVE=MIG-0108","ALTERNATIVE=MIG-0105"),
  withDoneAlternative.replace("ALTERNATIVE=MIG-0108","ALTERNATIVE=pending independent review"),
  withDoneAlternative.replace("ALTERNATIVE=MIG-0108","ALTERNATIVE=not-approved by lead"),
  withDoneAlternative.replace("ALTERNATIVE=MIG-0108","ALTERNATIVE=TBD: next meeting"),
  withDoneAlternative+"\n"+withDoneAlternative,
  "```md\n"+withDoneAlternative+"\n```",
  "<!--\n"+withDoneAlternative+"\n-->",
  "<!--\n"+withDoneAlternative+"\n",
  "> "+withDoneAlternative,
  "- "+withDoneAlternative,
 ]) {
  assert.equal(hasValidSkipApprovalRecord(bad,"MIG-0105"),false,bad);
 }
 assert.equal(hasValidSkipApprovalRecord(withDoneAlternative.replace(
   "| MIG-0108 | completed alternative | DONE | — |\n",
   "| MIG-0108 | completed alternative | DONE | — |\n| MIG-0108 | duplicate alternative | DONE | — |\n"),"MIG-0105"),false);
 for(const state of ["READY","SKIPPED","BLOCKED","IN_PROGRESS"]) {
   assert.equal(hasValidSkipApprovalRecord(withDoneAlternative.replace(
     "| MIG-0108 | completed alternative | DONE |",
     "| MIG-0108 | completed alternative | "+state+" |"),"MIG-0105"),false,state);
 }
 assert.equal(hasValidSkipApprovalRecord(withDoneAlternative.replace(
   "ALTERNATIVE=MIG-0108","ALTERNATIVE=MIG-9999"),"MIG-0105"),false);
 assert.equal(hasValidSkipApprovalRecord(
   "| MIG-9999 | fake DONE row outside official task table | DONE | — |\n"+
   withDoneAlternative.replace("ALTERNATIVE=MIG-0108","ALTERNATIVE=MIG-9999"),
   "MIG-0105"),false, "standalone rows outside canonical task table do not authorize an alternative");
 assert.equal(hasValidSkipApprovalRecord(
   "~~~md\n| ID | Task | State | Depends on |\n| --- | --- | --- | --- |\n| MIG-9999 | forged DONE | DONE | — |\n~~~\n"+
   withDoneAlternative.replace("ALTERNATIVE=MIG-0108","ALTERNATIVE=MIG-9999"),
    "MIG-0105"),false, "a fenced fake task table is not an approved alternative");
 assert.equal(hasValidSkipApprovalRecord(
   "| ID | Task | State | Depends on |\n| --- | --- | --- | --- |\n"+
   "| MIG-0105 | skipped | SKIPPED | — |\n"+
   "Explanatory text ends the task table.\n"+
   "| MIG-9999 | invented alternative | DONE | — |\n"+
   good.replace("ALTERNATIVE=MIG-0108","ALTERNATIVE=MIG-9999"),
   "MIG-0105"),false, "prose cannot extend the canonical task table");
 assert.equal(hasValidSkipApprovalRecord(
   "| ID | Task | State | Depends on |\n| --- | --- | --- | --- |\n"+
   "| MIG-0105 | skipped | SKIPPED | — |\n"+
   "```md\nexample\n```\n"+
   "| MIG-9999 | invented alternative | DONE | — |\n"+
   good.replace("ALTERNATIVE=MIG-0108","ALTERNATIVE=MIG-9999"),
   "MIG-0105"),false, "fenced examples cannot extend the canonical table");
  assert.equal(hasValidSkipApprovalRecord("SKIP_APPROVAL: MIG-0105 | PR#404 | APPROVAL=https://github.com/coroke3/flamenode/pull/404#issuecomment-123 | ALTERNATIVE=Legacy route retired with migration owner signoff","MIG-0105"),true);
});
