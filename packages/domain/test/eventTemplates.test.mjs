import assert from "node:assert/strict";
import test from "node:test";
import {
  validateDeleteEventTemplateId,
  validateSaveEventTemplateInput,
} from "@flamenode/domain/eventTemplates";

test("validateSaveEventTemplateInput accepts valid input", () => {
  const res = validateSaveEventTemplateInput({
    event_id: "evt-template-1",
    name: "標準テンプレート",
    description: "説明文",
  });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.data.event_id, "evt-template-1");
  assert.equal(res.data.name, "標準テンプレート");
  assert.equal(res.data.description, "説明文");
});

test("validateSaveEventTemplateInput rejects empty event_id or name", () => {
  const badEventId = validateSaveEventTemplateInput({
    event_id: "",
    name: "名前",
  });
  assert.equal(badEventId.ok, false);

  const badName = validateSaveEventTemplateInput({
    event_id: "evt-1",
    name: "",
  });
  assert.equal(badName.ok, false);
});

test("validateDeleteEventTemplateId validates non-empty templateId", () => {
  assert.deepEqual(validateDeleteEventTemplateId("etmpl-1"), {
    ok: true,
    templateId: "etmpl-1",
  });
  assert.equal(validateDeleteEventTemplateId("").ok, false);
  assert.equal(validateDeleteEventTemplateId(null).ok, false);
});
