import assert from "node:assert/strict";
import { test } from "node:test";
import { customQuestionToDraft } from "@flamenode/domain/event";

test("MIG-0652 U01: existing question projects every CURRENT draft field", () => {
  const question = {
    id: "ecq_1",
    question_key: "favorite_color",
    label: "Favorite color",
    description: "optional hint",
    type: "radio",
    required: true,
    options: ["red", "blue"],
    placeholder: "pick one",
    is_active: false,
  };
  const draft = customQuestionToDraft(question);
  assert.deepEqual(draft, {
    clientId: "ecq_1",
    question_key: "favorite_color",
    label: "Favorite color",
    description: "optional hint",
    type: "radio",
    required: true,
    options: ["red", "blue"],
    placeholder: "pick one",
    enabled: false,
  });
  // CURRENT projection reuses the same option array rather than copying it.
  assert.equal(draft.options, question.options);
});

test("MIG-0652 U01: null description/placeholder and disabled choice are unchanged", () => {
  const question = {
    id: "ecq_2",
    question_key: "notes",
    label: "Notes",
    description: null,
    type: "textarea",
    required: false,
    options: [],
    placeholder: null,
    is_active: true,
  };
  assert.deepEqual(customQuestionToDraft(question), {
    clientId: "ecq_2",
    question_key: "notes",
    label: "Notes",
    description: "",
    type: "textarea",
    required: false,
    options: [],
    placeholder: "",
    enabled: true,
  });
});
