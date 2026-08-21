import fs from "node:fs";

function replaceOnce(path, from, to) {
  const source = fs.readFileSync(path, "utf8");
  if (source.includes(to)) return false;
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`${path}: expected one match, got ${count}`);
  fs.writeFileSync(path, source.replace(from, to));
  return true;
}

const slotPath = "src/lib/actions/slot.ts";
let changed = false;
changed = replaceOnce(
  slotPath,
  `function adoptNullRowPatch(\n  row: SlotRow,\n  identity: { targetXId: string | null; adoptNullRows: boolean },\n): Pick<SlotPatch, "x_user_id"> {\n  if (identity.adoptNullRows && row.x_user_id === null && identity.targetXId !== null) {\n    return { x_user_id: identity.targetXId };\n  }\n  return {};\n}\n`,
  `function adoptNullRowPatch(\n  row: SlotRow,\n  identity: { targetXId: string | null; adoptNullRows: boolean },\n): Pick<SlotPatch, "x_user_id"> {\n  if (identity.adoptNullRows && row.x_user_id === null && identity.targetXId !== null) {\n    return { x_user_id: identity.targetXId };\n  }\n  return {};\n}\n\n/** 同じpatchを最大2群へまとめ、D1 statement数を枠数比例にしない。 */\nfunction buildRegroupMutations(\n  rows: readonly SlotRow[],\n  patch: SlotPatch,\n  identity: { targetXId: string | null; adoptNullRows: boolean },\n): SlotBulkMutation[] {\n  const keepRows: SlotRow[] = [];\n  const adoptRows: SlotRow[] = [];\n  for (const row of rows) {\n    if (identity.adoptNullRows && row.x_user_id === null && identity.targetXId !== null) {\n      adoptRows.push(row);\n    } else {\n      keepRows.push(row);\n    }\n  }\n  return [\n    ...(keepRows.length ? [{ rows: keepRows, patch, statusGuard: "reserved" as const }] : []),\n    ...(adoptRows.length ? [{ rows: adoptRows, patch: { ...patch, x_user_id: identity.targetXId }, statusGuard: "reserved" as const }] : []),\n  ];\n}\n`,
) || changed;
changed = replaceOnce(
  slotPath,
  `        ...groupRows.map((row) => ({\n          rows: [row],\n          patch: {\n            reservation_group_id: groupId,\n            ...adoptNullRowPatch(row, identity),\n          },\n          statusGuard: "reserved" as const,\n        })),\n`,
  `        ...buildRegroupMutations(\n          groupRows,\n          { reservation_group_id: groupId },\n          identity,\n        ),\n`,
) || changed;
changed = replaceOnce(
  slotPath,
  `        ...reservedRows.map((row) => ({\n          rows: [row],\n          patch: {\n            display_name: parsed.data.display_name,\n            reservation_group_id: groupId,\n            ...adoptNullRowPatch(row, identity),\n          },\n          statusGuard: "reserved" as const,\n        })),\n`,
  `        ...buildRegroupMutations(\n          reservedRows,\n          { display_name: parsed.data.display_name, reservation_group_id: groupId },\n          identity,\n        ),\n`,
) || changed;

const contractPath = "src/lib/slots/slotReservationLimit.contract.test.mjs";
let contract = fs.readFileSync(contractPath, "utf8");
if (!contract.includes("extend and merge bulk regroup")) {
  contract += `\n\ntest("extend and merge bulk regroup instead of one UPDATE per slot", () => {\n  assert.match(slotAction, /function buildRegroupMutations/);\n  assert.match(slotAction, /\.\.\.buildRegroupMutations\\(\\s*groupRows/);\n  assert.match(slotAction, /\.\.\.buildRegroupMutations\\(\\s*reservedRows/);\n});\n`;
  fs.writeFileSync(contractPath, contract);
  changed = true;
}
console.log(changed ? "finish-event-ux: applied D1 regroup optimization" : "finish-event-ux: already applied");
