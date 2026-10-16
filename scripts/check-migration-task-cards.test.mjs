import test from "node:test";
import assert from "node:assert/strict";
import { collectTaskCards,parseTrackedMigrationTasks,validateTaskCards } from "./check-migration-task-cards.mjs";

const status = `| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0301 | extraction | READY | MIG-0108 |
| MIG-0308 | DB schema | BLOCKED | MIG-0301 |
| MIG-0401 | public snapshot | BLOCKED | MIG-0308 |
| MIG-0601 | Hono health | BLOCKED | MIG-0308 |
| MIG-0801 | Auth fixtures | BLOCKED | MIG-0601 |
`;
const cards = {
  "docs/migration/TASK_CARDS_2_3.md": `# Phase 2
# Phase 3
### MIG-0301 — extraction
- 読む: real source
- 変更: copy logic
- 試験: node + TS + Next
- DONE: verified
### MIG-0308 — DB
- 読む: legacy schema
- 変更: packages/db
- 試験: zero diff
- DONE: verified
`,
  "docs/migration/TASK_CARDS_4_5.md":"# Phase 4\n# Phase 5\n### MIG-0401 — snapshot\n- 読む: code\n- 変更: build loader\n- 試験: output\n- DONE: verified\n",
  "docs/migration/TASK_CARDS_6_7.md":"# Phase 6\n# Phase 7\n### MIG-0601 — health\n- 読む: RH-018\n- 変更: Hono\n- 試験: API\n- DONE: verified\n",
  "docs/migration/TASK_CARDS_8_9.md":"# Phase 8\n# Phase 9\n### MIG-0801 — fixtures\n- 読む: auth\n- 変更: tests\n- 試験: compare\n- DONE: verified\n",
};
const base={
  status, fileContents: cards, runbook: "1 wake = 1 task BLOCKED_ON_USER",
  protocol:"Read IMPLEMENTATION_RUNBOOK.md and TASK_CARDS_*.md",
  decisions:"D-01 MIG-0308; D-08",
  smokeDocs:"EXACT FILES",
};

test("status tasks and card IDs parse uniquely", () => {
  assert.equal(parseTrackedMigrationTasks(status).size,5);
  assert.equal(collectTaskCards(cards).cards.size,5);
});

test("small-model work card contract accepts complete fixtures", () => {
  assert.deepEqual(validateTaskCards(base),[]);
});

test("one wake permits one action and still rejects an unbounded work cycle", () => {
  assert.deepEqual(validateTaskCards({...base,runbook:base.runbook.replace("1 task", "1 action")}),[]);
  assert.match(validateTaskCards({...base,runbook:base.runbook.replace("1 task", "2 actions")}).join(" "), /one-wake/);
});

test("missing task, duplicate task, orphan task all fail", () => {
  const missing={...cards, "docs/migration/TASK_CARDS_2_3.md":cards["docs/migration/TASK_CARDS_2_3.md"].replace(/### MIG-0308[\s\S]*/,"")};
  assert.match(validateTaskCards({...base,fileContents:missing}).join(" "),/MIG-0308: STATUS task without executable/);
  const duplicate={...cards, "docs/migration/TASK_CARDS_4_5.md":cards["docs/migration/TASK_CARDS_4_5.md"] + "\n" + cards["docs/migration/TASK_CARDS_2_3.md"]};
  assert.match(validateTaskCards({...base,fileContents:duplicate}).join(" "),/duplicate card/);
  const orphan={...cards, "docs/migration/TASK_CARDS_4_5.md":cards["docs/migration/TASK_CARDS_4_5.md"] + "\n### MIG-0402 --- test\n- 読む:\n- 変更:\n- 試験:\n- DONE:\n"};
  assert.match(validateTaskCards({...base,fileContents:orphan}).join(" "),/no STATUS task/);
});

test("incomplete card cannot pass merely by presence of MIG heading", () => {
  const incomplete={...cards,"docs/migration/TASK_CARDS_2_3.md":cards["docs/migration/TASK_CARDS_2_3.md"].replace("- 試験: zero diff","- test omitted")};
  assert.match(validateTaskCards({...base,fileContents:incomplete}).join(" "),/missing card field 試験:/);
});

test("missing protocol references and D-08 guard fail", () => {
  assert.match(validateTaskCards({...base,protocol:"ignore runbook"}).join(" "),/IMPLEMENTATION_RUNBOOK/);
  assert.match(validateTaskCards({...base,runbook:"1 wake = 1 task"}).join(" "),/HTML mock safety gate/);
});

test("large task must have micro-unit recipe", () => {
  assert.match(validateTaskCards({...base,microUnits:"# no packets"}).join(" "),/MIG-0705: large task/);
});

import { extractWorkOrder, validateWorkOrder, validateWorkOrders, WORK_ORDER_SECTIONS, readSpecs } from "./check-migration-task-cards.mjs";

const completeOrder = (id, model = "small", readiness = "READY_FOR_SMALL_MODEL") => [
  "### " + id + ": title",
  "- **Model:** " + model,
  "- **Readiness:** " + readiness,
  "- **Recipe:** R-DOMAIN",
  "- **Runtime:** N",
  "- **Verified against:** `5d15922f` (2026-10-13)",
  ...WORK_ORDER_SECTIONS.flatMap((section) => ["#### " + section, section === "Micro-units" ? "- **U01 step** — 手順\n```bash\n# comment inside fence is not a heading\nnode --test\n```\n期待: 終了コード0" : "- item"]),
].join("\n");

test("work order section ends at the next heading outside fenced code", () => {
  const spec = completeOrder("MIG-0301") + "\n### MIG-0302: next\n- **Model:** lead";
  const order = extractWorkOrder(spec, "MIG-0301");
  assert.equal(order.model, "small");
  assert.equal(order.readiness, "READY_FOR_SMALL_MODEL");
  assert.match(order.text, /# comment inside fence/);
  assert.doesNotMatch(order.text, /MIG-0302/);
  assert.equal(extractWorkOrder(spec, "MIG-0302").model, "lead");
});

test("READY task requires a complete work order before small-model execution", () => {
  const specs = { "docs/migration/PHASE_3_SPEC.md": completeOrder("MIG-0301") };
  assert.deepEqual(validateWorkOrders({ status, specs }), []);
  assert.match(validateWorkOrders({ status, specs: {} }).join(" "), /MIG-0301: READY task has no work order/);
  const missingStop = { "docs/migration/PHASE_3_SPEC.md": completeOrder("MIG-0301").replace("#### STOP", "#### Notes") };
  assert.match(validateWorkOrders({ status, specs: missingStop }).join(" "), /missing #### STOP/);
  const leadReady = { "docs/migration/PHASE_3_SPEC.md": completeOrder("MIG-0301", "lead") };
  assert.match(validateWorkOrders({ status, specs: leadReady }).join(" "), /requires Model: small/);
  const refinement = { "docs/migration/PHASE_3_SPEC.md": "### MIG-0301: t\n- **Model:** small\n- **Readiness:** NEEDS_REFINEMENT — waiting" };
  assert.deepEqual(validateWorkOrders({ status, specs: refinement }), []);
  const duplicate = { "docs/migration/PHASE_3_SPEC.md": completeOrder("MIG-0301") + "\n" + completeOrder("MIG-0301") };
  assert.match(validateWorkOrders({ status, specs: duplicate }).join(" "), /duplicate work order heading MIG-0301/);
});

import { validatePlanCompleteness } from "./check-migration-task-cards.mjs";

test("every unfinished task needs a full work order whose dependencies match STATUS", () => {
  const graph = `| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0108 | gate | DONE | MIG-0102..MIG-0107 |
| MIG-0301 | extraction | READY | MIG-0108 |
| MIG-0302 | read | BLOCKED | MIG-0301 |
| MIG-0303 | write | BLOCKED | MIG-0302 |
`;
  const order = (id, depends) => completeOrder(id, "lead", "NEEDS_REFINEMENT — x").replace("- **Verified against:**", "- **Depends on:** " + depends + " / **Decisions:** none\n- **Verified against:**");
  const spec = (o303) => ({ "docs/migration/PHASE_3_SPEC.md": [order("MIG-0301", "MIG-0108"), order("MIG-0302", "MIG-0301"), o303].join("\n") });
  assert.deepEqual(validatePlanCompleteness({ status: graph, specs: spec(order("MIG-0303", "MIG-0302")) }), []);
  // transitive dependency already implied by STATUS is allowed
  assert.deepEqual(validatePlanCompleteness({ status: graph, specs: spec(order("MIG-0303", "MIG-0302, MIG-0301")) }), []);
  assert.match(validatePlanCompleteness({ status: graph, specs: spec(order("MIG-0303", "MIG-0301")) }).join(" "), /MIG-0303: work order Depends on omits STATUS dependency MIG-0302/);
  assert.match(validatePlanCompleteness({ status: graph.replace("| MIG-0302 | read | BLOCKED | MIG-0301 |", "| MIG-0302 | read | BLOCKED | MIG-0108 |"), specs: spec(order("MIG-0303", "MIG-0302, MIG-0301")) }).join(" "), /MIG-0303: work order depends on MIG-0301 but STATUS has no such dependency path/);
  assert.match(validatePlanCompleteness({ status: graph, specs: spec("") }).join(" "), /MIG-0303: unfinished task has no work order/);
  assert.match(validatePlanCompleteness({ status: graph, specs: spec(order("MIG-0303", "MIG-0302").replace("#### Rollback", "#### Notes")) }).join(" "), /MIG-0303: work order missing #### Rollback/);
  assert.match(validatePlanCompleteness({ status: graph.replace("| MIG-0302 | read | BLOCKED |", "| MIG-0302 | read | READY |"), specs: spec(order("MIG-0303", "MIG-0302")) }).join(" "), /MIG-0302: READY but dependency MIG-0301 is READY/);
});

import { validateSmallModelOrder, validateWorkOrder, readSpecs } from "./check-migration-task-cards.mjs";

test("small-model work order must be decided: commands, expectations, exact paths, no vague wording", () => {
  assert.deepEqual(validateSmallModelOrder("MIG-0301", completeOrder("MIG-0301")), []);
  const noExpect = completeOrder("MIG-0301").replace("期待: 終了コード0", "");
  assert.match(validateSmallModelOrder("MIG-0301", noExpect).join(" "), /expected result/);
  const vague = completeOrder("MIG-0301").replace("- item", "- 必要に応じて直す");
  assert.match(validateSmallModelOrder("MIG-0301", vague).join(" "), /undecided wording: 必要に応じて/);
  const glob = completeOrder("MIG-0301").replace("#### Owned paths\n- item", "#### Owned paths\n- 新規: `packages/ui/src/*.tsx`");
  assert.match(validateSmallModelOrder("MIG-0301", glob).join(" "), /exact files, not globs/);
});

test("unfinished work orders name a known recipe and runtime class", () => {
  const graph = "| ID | Task | State | Depends on |\n| --- | --- | --- | --- |\n| MIG-0108 | gate | DONE | — |\n| MIG-0301 | x | READY | MIG-0108 |\n";
  const order = completeOrder("MIG-0301").replace("- **Verified against:**", "- **Depends on:** MIG-0108 / **Decisions:** none\n- **Verified against:**");
  const specs = (o) => ({ "docs/migration/PHASE_3_SPEC.md": o });
  const recipes = "## R-DOMAIN: move\n## R-API: hono\n";
  assert.deepEqual(validatePlanCompleteness({ status: graph, specs: specs(order), recipes }), []);
  assert.match(validatePlanCompleteness({ status: graph, specs: specs(order.replace("R-DOMAIN", "R-MAGIC")), recipes }).join(" "), /Recipe R-MAGIC is not a section/);
  assert.match(validatePlanCompleteness({ status: graph, specs: specs(order.replace("- **Runtime:** N", "- **Runtime:** fast")), recipes }).join(" "), /Runtime must list/);
  assert.match(validatePlanCompleteness({ status: graph, specs: specs(order.replace("- **Recipe:** R-DOMAIN\n", "")), recipes }).join(" "), /missing Recipe/);
});

test("code examples cannot declare work-order readiness or required sections", () => {
  for (const fence of ["```", "~~~~"]) {
    const example = "### MIG-0301: example\n" + fence + "markdown\n" + completeOrder("MIG-0301") + "\n" + fence;
    const order = extractWorkOrder(example, "MIG-0301");
    assert.equal(order.model, null);
    assert.equal(order.readiness, null);
    assert.ok(validateWorkOrder("MIG-0301", order).length > 0);
  }
  const missingStop = completeOrder("MIG-0301").replace("#### STOP\n- item", "```markdown\n#### STOP\n- item\n```");
  assert.match(validateWorkOrder("MIG-0301", extractWorkOrder(missingStop, "MIG-0301")).join(" "), /missing #### STOP/);
});

test("duplicate metadata, sections and empty recipes fail closed", () => {
  for (const suffix of ["\n- **Model:** small", "\n- **Readiness:** READY_FOR_SMALL_MODEL", "\n#### STOP\n- another rule"]) {
    const order = extractWorkOrder(completeOrder("MIG-0301") + suffix, "MIG-0301");
    assert.match(validateWorkOrder("MIG-0301", order).join(" "), /duplicate/);
  }
  const empty = completeOrder("MIG-0301").replace("#### STOP\n- item", "#### STOP\n");
  assert.match(validateWorkOrder("MIG-0301", extractWorkOrder(empty, "MIG-0301")).join(" "), /empty #### STOP/);
  assert.equal(extractWorkOrder(completeOrder("MIG-0301") + "\n" + completeOrder("MIG-0301"), "MIG-0301"), null);
});

test("spec read errors cannot silently hide invalid work orders", () => {
  assert.throws(() => readSpecs(() => { throw Object.assign(new Error("access denied"), { code: "EACCES" }); }), /access denied/);
  assert.ok(Object.values(readSpecs(() => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); })).every(value => value === undefined));
});

test("the work order validator also applies the small-model content checks", () => {
  const vague = extractWorkOrder(completeOrder("MIG-0301").replace("- item", "- 必要に応じて直す"), "MIG-0301");
  assert.match(validateWorkOrder("MIG-0301", vague).join(" "), /undecided wording/);
});

test("code examples cannot declare work-order readiness or required sections", () => {
  for (const fence of ["```", "~~~~"]) {
    const example = "### MIG-0301: example\n" + fence + "markdown\n" + completeOrder("MIG-0301") + "\n" + fence;
    const order = extractWorkOrder(example, "MIG-0301");
    assert.equal(order.model, null);
    assert.equal(order.readiness, null);
    assert.ok(validateWorkOrder("MIG-0301", order).length > 0);
  }
  const missingStop = completeOrder("MIG-0301").replace("#### STOP\n- item", "```markdown\n#### STOP\n- item\n```");
  assert.match(validateWorkOrder("MIG-0301", extractWorkOrder(missingStop, "MIG-0301")).join(" "), /missing #### STOP/);
});

test("duplicate metadata, sections and empty recipes fail closed", () => {
  for (const suffix of ["\n- **Model:** small", "\n- **Readiness:** READY_FOR_SMALL_MODEL", "\n#### STOP\n- another rule"]) {
    const order = extractWorkOrder(completeOrder("MIG-0301") + suffix, "MIG-0301");
    assert.match(validateWorkOrder("MIG-0301", order).join(" "), /duplicate/);
  }
  const empty = completeOrder("MIG-0301").replace("#### STOP\n- item", "#### STOP\n");
  assert.match(validateWorkOrder("MIG-0301", extractWorkOrder(empty, "MIG-0301")).join(" "), /empty #### STOP/);
  assert.equal(extractWorkOrder(completeOrder("MIG-0301") + "\n" + completeOrder("MIG-0301"), "MIG-0301"), null);
});

test("spec read errors cannot silently hide invalid work orders", () => {
  assert.throws(() => readSpecs(() => { throw Object.assign(new Error("access denied"), { code: "EACCES" }); }), /access denied/);
  assert.ok(Object.values(readSpecs(() => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); })).every(value => value === undefined));
});
