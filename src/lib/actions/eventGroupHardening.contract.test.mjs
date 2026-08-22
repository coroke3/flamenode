import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const action = read("./event-group-admin.ts");
const form = read("../../components/admin/EventGroupForm.tsx");
const editor = read("../../components/admin/EventGroupMembersEditor.tsx");
const page = read("../../../app/(admin)/admin/event-groups/[id]/edit/page.tsx");
const options = read("../admin/eventGroupEventOptions.ts");

test("event group edit carries a revision and applies the CAS before the visibility fence", () => {
  assert.match(action, /base_updated_at: z\.coerce\.number\(\)/);
  assert.match(form, /name="base_updated_at"/);
  assert.match(page, /base_updated_at: row\.updated_at/);
  const stale = action.indexOf("data.base_updated_at == null");
  const fence = action.indexOf("planEventGroupVisibilityFenceTransition", stale);
  assert.ok(stale >= 0);
  assert.ok(fence > stale);
  assert.match(action, /eq\(eventGroups\.updated_at, existing\.updated_at\)/);
});

test("event group updates preserve img_url and bulk operations preflight the audit budget", () => {
  const updateStart = action.indexOf("export async function updateEventGroup");
  const updateEnd = action.indexOf("export async function deleteEventGroup", updateStart);
  const updateSource = action.slice(updateStart, updateEnd);
  assert.doesNotMatch(updateSource, /img_url:\s*null/);
  assert.match(action, /planD1AuditMutationBudget/);
  assert.match(action, /const EVENT_GROUP_ADD_MAX = 80/);
  assert.match(action, /if \(eventIds\.length > EVENT_GROUP_ADD_MAX\)/);
});

test("event group candidates use bounded cursor search instead of a silent 500-row cap", () => {
  assert.doesNotMatch(page, /\.limit\(500\)/);
  assert.match(page, /queryEventGroupEventOptions/);
  assert.match(editor, /searchEventGroupEventOptions/);
  assert.match(editor, /さらに読み込む/);
  assert.match(options, /EVENT_GROUP_EVENT_PAGE_SIZE = 80/);
  assert.match(options, /\.limit\(EVENT_GROUP_EVENT_PAGE_SIZE \+ 1\)/);
  assert.match(options, /notExists/);
});

test("event group action boundaries fail closed for malformed runtime input", () => {
  assert.match(action, /searchEventGroupEventOptions\(input: unknown\)/);
  assert.match(action, /typeof raw\.groupId === "string"/);
  assert.match(action, /typeof groupId === "string" \? groupId\.trim\(\)/);
  assert.match(action, /typeof input\?\.eventId === "string"/);
});
