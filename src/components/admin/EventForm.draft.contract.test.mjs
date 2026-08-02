import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./EventForm.tsx", import.meta.url), "utf8");
const unsavedGuardSource = await readFile(
  new URL("../../lib/interactions/useUnsavedChangesGuard.ts", import.meta.url),
  "utf8",
);
const adminNewSource = await readFile(
  new URL("../../../app/(admin)/admin/events/new/page.tsx", import.meta.url),
  "utf8",
);
const manageEditSource = await readFile(
  new URL("../../../app/(manage)/manage/events/[id]/edit/page.tsx", import.meta.url),
  "utf8",
);

test("EventForm keeps authenticated drafts isolated and guards unsaved changes", () => {
  assert.match(source, /useFormDraft/);
  assert.match(source, /useUnsavedChangesGuard/);
  assert.match(source, /buildFormDraftStorageKey/);
  assert.match(source, /event-form-v1/);
  assert.match(unsavedGuardSource, /beforeunload/);
  assert.match(source, /clearDraft\(\)/);
  assert.match(source, /setDirty\(false\)/);
  assert.match(source, /formDataToDraftValue/);
});

test("event create and edit pages scope drafts to the authenticated user", () => {
  assert.match(adminNewSource, /draftAuthUserId=\{user\?\.id\}/);
  assert.match(manageEditSource, /draftAuthUserId=\{user\.id\}/);
});
