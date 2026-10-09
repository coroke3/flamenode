import test from "node:test";
import assert from "node:assert/strict";
import { collectTaskCards,parseTrackedMigrationTasks,validateTaskCards } from "./check-migration-task-cards.mjs";

const status = `| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0301 | extraction | READY | MIG-0108 |
| MIG-0308 | DB schema | BLOCKED | MIG-0301 |
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
  "docs/migration/TASK_CARDS_4_5.md":"# Phase 4\n# Phase 5\n",
  "docs/migration/TASK_CARDS_6_7.md":"# Phase 6\n# Phase 7\n",
  "docs/migration/TASK_CARDS_8_9.md":"# Phase 8\n# Phase 9\n",
};
const base={
  status, fileContents: cards, runbook: "1 wake = 1 task BLOCKED_ON_USER",
  protocol:"Read IMPLEMENTATION_RUNBOOK.md and TASK_CARDS_*.md",
  decisions:"D-01 MIG-0308; D-08",
  smokeDocs:"EXACT FILES",
};

test("status tasks and card IDs parse uniquely", () => {
  assert.equal(parseTrackedMigrationTasks(status).size,2);
  assert.equal(collectTaskCards(cards).cards.size,2);
});

test("small-model work card contract accepts complete fixtures", () => {
  assert.deepEqual(validateTaskCards(base),[]);
});

test("missing task, duplicate task, orphan task all fail", () => {
  const missing={...cards, "docs/migration/TASK_CARDS_2_3.md":cards["docs/migration/TASK_CARDS_2_3.md"].replace(/### MIG-0308[\s\S]*/,"")};
  assert.match(validateTaskCards({...base,fileContents:missing}).join(" "),/MIG-0308: STATUS task without executable/);
  const duplicate={...cards, "docs/migration/TASK_CARDS_4_5.md":cards["docs/migration/TASK_CARDS_4_5.md"] + "\n" + cards["docs/migration/TASK_CARDS_2_3.md"]};
  assert.match(validateTaskCards({...base,fileContents:duplicate}).join(" "),/duplicate card/);
  const orphan={...cards, "docs/migration/TASK_CARDS_4_5.md":cards["docs/migration/TASK_CARDS_4_5.md"] + "\n### MIG-0401 --- test\n- 読む:\n- 変更:\n- 試験:\n- DONE:\n"};
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
