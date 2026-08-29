import assert from "node:assert/strict";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  const { readGeneralCustomQuestionsFromFormData } = await import(
    "./generalCustomQuestionDraft.ts"
  );

  test("form reader keeps general keys and drops only real stage keys", () => {
    const formData = new FormData();
    formData.set("general_custom_questions_present", "1");
    formData.append("general_custom_question_key", "stage_permission");
    formData.append("general_custom_question_key", "stage_permissionfoo");
    formData.append("general_custom_question_key", "q_ok");
    for (const enabled of ["1", "1", "1"]) {
      formData.append("general_custom_question_enabled", enabled);
    }
    for (const required of ["0", "0", "0"]) {
      formData.append("general_custom_question_required", required);
    }
    formData.append("general_custom_question_type", "radio");
    formData.append("general_custom_question_type", "text");
    formData.append("general_custom_question_type", "radio");
    formData.append("general_custom_question_label", "stage");
    formData.append("general_custom_question_label", "not stage");
    formData.append("general_custom_question_label", "ok");
    formData.append("general_custom_question_description", "");
    formData.append("general_custom_question_description", "");
    formData.append("general_custom_question_description", "");
    formData.append("general_custom_question_placeholder", "");
    formData.append("general_custom_question_placeholder", "");
    formData.append("general_custom_question_placeholder", "");
    formData.append("general_custom_question_options", "はい\nはい\n");
    formData.append("general_custom_question_options", "");
    formData.append("general_custom_question_options", "A\nB");

    const drafts = readGeneralCustomQuestionsFromFormData(formData);
    assert.equal(drafts.length, 2);
    assert.equal(drafts[0].question_key, "stage_permissionfoo");
    assert.equal(drafts[1].question_key, "q_ok");
    assert.deepEqual(drafts[1].options, ["A", "B"]);
  });
}
