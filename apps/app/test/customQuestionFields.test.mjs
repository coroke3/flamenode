// MIG-0712 U02: contract smoke checks for each CURRENT custom-question input type.
import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { CustomQuestionFields } = await import("../.test-dist/apps/app/src/components/forms/CustomQuestionFields.js");
const { questionTypeNeedsOptions } = await import("../.test-dist/apps/app/src/lib/customQuestions.js");

const html = (over = {}) => renderToStaticMarkup(React.createElement(CustomQuestionFields, {
  id: "question-1", name: "answers[question-1]", type: "text",
  options: [], values: ["投稿文"], ...over,
}));

test("MIG-0712 U02 T01: text/textarea preserve name, required and aria-invalid semantics", () => {
  const input = html({ required: true, invalid: true, describedBy: "error-q1" });
  assert.match(input, /type="text"/);
  assert.match(input, /name="answers\[question-1\]"/);
  assert.match(input, /required=""/);
  assert.match(input, /aria-invalid="true"/);
  assert.match(input, /aria-describedby="error-q1"/);

  const textarea = html({ type: "textarea", placeholder: "作品について", maxLength: 200 });
  assert.match(textarea, /<textarea/);
  assert.match(textarea, /rows="3"/);
  assert.match(textarea, /maxlength="200"/i);
  assert.match(textarea, /投稿文/);
});

test("MIG-0712 U02 T01: select/radio/checkbox choice options and selection match CURRENT", () => {
  const options = ["A", " B ", "  "];
  const select = html({ type: "select", options, values: ["B"] });
  assert.match(select, /<select/);
  assert.match(select, /<option value="B" selected=""/);
  const radio = html({ type: "radio", options, values: ["B"] });
  assert.match(radio, /role="radiogroup"/);
  assert.match(radio, /cq-customChoiceOption/);
  assert.match(radio, /type="radio"/);
  assert.match(radio, /value="B" checked=""/);
  const checkbox = html({ type: "checkbox", options, values: ["A"], required: true });
  assert.match(checkbox, /type="checkbox"/);
  assert.match(checkbox, /value="A" checked=""/);
  assert.doesNotMatch(checkbox, /required=""/, "checkbox group required is validated at form level");
  for (const type of ["select", "radio", "checkbox"]) assert.equal(questionTypeNeedsOptions(type), true);
  for (const type of ["text", "textarea"]) assert.equal(questionTypeNeedsOptions(type), false);
});

test("MIG-0712 U02 T01: preview never serializes form field names or activates required inputs", () => {
  for (const type of ["text", "textarea", "select", "radio", "checkbox"]) {
    const output = html({ type, options: ["A"], values: ["A"], preview: true, required: true });
    assert.doesNotMatch(output, /name="answers\[/);
    assert.doesNotMatch(output, /required=""/);
    assert.match(output, /tabindex="-1"/i);
  }
  assert.match(html({ type: "radio", options: [], preview: true }), /選択肢を追加すると/);
  assert.match(html({ type: "radio", options: [] }), /この質問の選択肢がまだ設定されていません/);
});
