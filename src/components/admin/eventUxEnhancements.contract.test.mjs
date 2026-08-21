import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const staff = fs.readFileSync("src/components/admin/EventStaffManager.tsx", "utf8");
const editor = fs.readFileSync("src/components/admin/YoutubeDescriptionTemplateEditor.tsx", "utf8");
const form = fs.readFileSync("src/components/admin/EventForm.tsx", "utf8");
const grid = fs.readFileSync("src/components/event/SlotGrid.tsx", "utf8");

test("permission UI uses Japanese definitions instead of raw keys", () => {
  assert.match(staff, /PERMISSION_DEFINITIONS/);
  assert.match(staff, /definition\.label/);
  assert.match(staff, /definition\.description/);
  assert.doesNotMatch(staff, /\{key\}\s*<\/label>/);
});

test("YouTube template editor is controlled and GUI changes participate in form drafts", () => {
  assert.match(editor, /value: string;/);
  assert.match(editor, /onChange: \(value: string\) => void;/);
  assert.match(form, /youtubeDescriptionTemplate/);
  assert.match(form, /setYoutubeDescriptionTemplate/);
});

test("consecutive slot UX explains one-work semantics and X ID limit", () => {
  assert.match(grid, /buildConsecutiveSlotGuidance/);
  assert.match(grid, /この選択は1作品分です/);
  assert.match(grid, /slotReservationLimitMessage/);
});
