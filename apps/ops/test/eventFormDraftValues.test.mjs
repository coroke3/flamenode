// MIG-0721 U01b-1: CURRENT parity for multi-value form drafts (no route or write API).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { formDataToDraftValue, draftValueToFormData } from "../.test-dist/apps/ops/src/lib/eventFormDraftValues.js";

test("U01b-1 keeps the exact CURRENT EventForm draft serializer bodies", () => {
  const current = readFileSync(new URL("../../../src/components/admin/EventForm.tsx", import.meta.url), "utf8");
  const port = readFileSync(new URL("../src/lib/eventFormDraftValues.ts", import.meta.url), "utf8");
  const start = current.indexOf("function formDataToDraftValue(");
  const end = current.indexOf("function partsJsonToText(");
  assert.ok(start >= 0 && end > start, "CURRENT functions must exist");
  assert.ok(port.includes(current.slice(start, end).trimEnd()), "migrated serializer diverged from CURRENT");
});

test("U01b-1 preserves repeated values, blank strings, and insertion order", () => {
  const form = new FormData();
  form.append("title", "春の上映会");
  form.append("custom_question_id", "q1");
  form.append("custom_question_id", "q2");
  form.append("note", "");
  form.append("title", "改訂版");
  const draft = formDataToDraftValue(form);
  assert.deepEqual(draft, {
    title: ["春の上映会", "改訂版"],
    custom_question_id: ["q1", "q2"],
    note: "",
  });
  const restored = draftValueToFormData(draft);
  assert.deepEqual(restored.getAll("title"), ["春の上映会", "改訂版"]);
  assert.deepEqual(restored.getAll("custom_question_id"), ["q1", "q2"]);
  assert.deepEqual(restored.getAll("note"), [""]);
  assert.deepEqual([...restored.keys()], ["title", "title", "custom_question_id", "custom_question_id", "note"]);
});

test("U01b-1 ignores File entries, without deleting same-name text entries", () => {
  const form = new FormData();
  form.append("attachment", new Blob(["private"]), "private.txt");
  form.append("attachment", "safe-text");
  form.append("only_file", new Blob(["x"]), "x.bin");
  const draft = formDataToDraftValue(form);
  assert.deepEqual(draft, { attachment: "safe-text" });
  assert.deepEqual([...draftValueToFormData(draft).entries()], [["attachment", "safe-text"]]);
});

test("U01b-1 leaves an empty form empty", () => {
  const draft = formDataToDraftValue(new FormData());
  assert.deepEqual(draft, {});
  assert.equal([...draftValueToFormData(draft).entries()].length, 0);
});
