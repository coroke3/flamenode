import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { mockArtifactExists, readUiReferenceInputs, validateUiReference } from "./check-migration-ui-reference.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = () => readUiReferenceInputs(root);
test("registered source joins every CURRENT route and all supplied mock artifacts", () => {
  assert.deepEqual(validateUiReference(fixture()), []);
});
test("CURRENT classification totals derive from real route rows", () => {
  const f = fixture(); f.currentRoutesText = f.currentRoutesText.replace(/DEV_ONLY\s+1/, "DEV_ONLY                3");
  assert.match(validateUiReference(f).join("\n"), /classification count mismatch: DEV_ONLY/);
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

test("mock artifacts require an actual file whose resolved target stays inside the registered bundle", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "flamenode-ui-mock-"));
  try {
    const mock = path.join(tmp, "docs/migration/mock");
    const inside = path.join(mock, "nested");
    const external = path.join(tmp, "external");
    fs.mkdirSync(inside, { recursive: true });
    fs.mkdirSync(external);
    fs.writeFileSync(path.join(inside, "inside.html"), "<p>registered</p>");
    fs.writeFileSync(path.join(external, "external.html"), "<p>not registered</p>");
    fs.symlinkSync("nested/inside.html", path.join(mock, "internal-alias.html"), "file");
    fs.symlinkSync(inside, path.join(mock, "internal-dir-alias"), "dir");
    fs.symlinkSync(path.join(external, "external.html"), path.join(mock, "external-alias.html"), "file");
    fs.symlinkSync(external, path.join(mock, "external-dir-alias"), "dir");
    fs.symlinkSync(path.join(tmp, "missing-target.html"), path.join(mock, "dangling.html"), "file");

    for (const candidate of [
      "nested/inside.html",
      "internal-alias.html",
      "internal-dir-alias/inside.html",
    ]) assert.equal(mockArtifactExists(tmp, candidate), true, candidate);

    for (const candidate of [
      "external-alias.html",
      "external-dir-alias/external.html",
      "dangling.html",
      "nested",
      "missing.html",
      "../external/external.html",
      path.join(external, "external.html"),
      "",
    ]) assert.equal(mockArtifactExists(tmp, candidate), false, candidate);

    // readUiReferenceInputs must use the same canonical guard, not existsSync.
    const registered = readUiReferenceInputs(root);
    assert.equal(registered.artifactExists("source/boards/Main.dc.html"), true);
    assert.equal(registered.artifactExists("nonexistent-artifact.html"), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
