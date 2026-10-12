import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readUiReferenceInputs, validateUiReference } from "./check-migration-ui-reference.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = () => readUiReferenceInputs(root);
test("registered source joins every CURRENT route and all supplied mock artifacts", () => {
  assert.deepEqual(validateUiReference(fixture()), []);
});
test("rejects invented UX IDs rather than silently treating them as coverage", () => {
  const f = fixture(); f.uiText += "\nUX-TOP-001\n";
  assert.match(validateUiReference(f).join("\n"), /must not duplicate UX\/FN IDs/);
});
test("rejects mock-only routes promoted into CURRENT migration work", () => {
  const f = fixture(); f.uiText = f.uiText.replace("| `/manage` |", "| `/manage/events/[id]/inbox` |");
  const errors = validateUiReference(f).join("\n");
  assert.match(errors, /unknown CURRENT route/); assert.match(errors, /missing CURRENT route: \/manage/);
});
test("rejects missing routes, including entry variants and admin tabs", () => {
  for (const route of ["/entry/slotted", "/entry/unslotted", "/admin/audit/restore", "/admin/videos/[id]/members"]) {
    const f = fixture(); f.uiText = f.uiText.split("\n").filter(l => !l.startsWith("| `" + route + "` |")).join("\n");
    assert.match(validateUiReference(f).join("\n"), /missing CURRENT route/, route);
  }
});
test("rejects private mock as visual acceptance and unrelated public mock", () => {
  const f = fixture(); f.uiText = f.uiText.replace("| `/dashboard` | VISUAL_SCREEN | CURRENT_UI_REUSE", "| `/dashboard` | VISUAL_SCREEN | PUBLIC_MOCK")
    .replace("| `/` | VISUAL_SCREEN | PUBLIC_MOCK | `Main`", "| `/` | VISUAL_SCREEN | PUBLIC_MOCK | `About`");
  const errors = validateUiReference(f).join("\n");
  assert.match(errors, /expected visual policy CURRENT_UI_REUSE/); assert.match(errors, /wrong public mock/);
});
test("missing mock artifacts and unclassified parts fail validation", () => {
  const f = fixture(); f.artifactExists = () => false;
  assert.match(validateUiReference(f).join("\n"), /missing artifact/);
  const g = fixture(); g.uiText = g.uiText.split("\n").filter(l => !l.startsWith("| `ManageInbox` |")).join("\n");
  assert.match(validateUiReference(g).join("\n"), /missing mock disposition: ManageInbox/);
});
