import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  generalCustomQuestionsPresentCore,
  readGeneralCustomQuestionsFromFormDataCore,
} from "@flamenode/domain/event";
import {
  normalizeOptionList,
  parseQuestionType,
} from "../../../src/lib/video/customQuestions.ts";
import { isStagePermissionQuestionKey } from "../../../src/lib/video/formSettings.ts";

// Execute CURRENT's real scalar policies rather than a test-only approximation.
const adapters = { normalizeOptionList, parseQuestionType, isStagePermissionQuestionKey };
function form(fields = {}) {
  const data = new FormData();
  for (const [key, values] of Object.entries(fields)) {
    for (const v of Array.isArray(values) ? values : [values]) data.append(key, v);
  }
  return data;
}
const read = (fields) => readGeneralCustomQuestionsFromFormDataCore(form(fields), adapters);

test("MIG-0652 U01: absent, false and true-like presence markers ignore all drafts", () => {
  for (const marker of [undefined, "0", "true", "on", ""]) {
    const fields = { general_custom_question_key: "keep" };
    if (marker !== undefined) fields.general_custom_questions_present = marker;
    assert.deepEqual(read(fields), []);
  }
  assert.equal(generalCustomQuestionsPresentCore(form({general_custom_questions_present:"1"})), true);
  assert.equal(generalCustomQuestionsPresentCore(form({general_custom_questions_present:"true"})), false);
});

test("MIG-0652 U01: enabled and disabled questions remain in original positional order", () => {
  const rows = read({
    general_custom_questions_present: "1",
    general_custom_question_key: [" first ", "second"],
    general_custom_question_label: [" First question ", "Second"],
    general_custom_question_type: ["radio", "text"],
    general_custom_question_required: ["1", "on"],
    general_custom_question_enabled: ["true", "1"],
    general_custom_question_description: [" Description ", "  "],
    general_custom_question_placeholder: [" Select ", ""],
    general_custom_question_options: ["red\r\nblue", "ignore"],
  });
  assert.deepEqual(rows, [
    { clientId:"first", question_key:"first", label:"First question",
      description:"Description", type:"radio", required:true,
      options:["red","blue"], placeholder:"Select", enabled:false },
    { clientId:"second", question_key:"second", label:"Second",
      description:"", type:"text", required:false,
      options:["ignore"], placeholder:"", enabled:true },
  ]);
});

test("MIG-0652 U01: reserved keys are dropped, case is retained and other rows are preserved", () => {
  const rows = read({
    general_custom_questions_present:"1",
    general_custom_question_key:[" ", " stage_permission ", "stage_permission_2",
      "Stage_permission", "a b", "a b"],
    general_custom_question_label:["one","two","three","four","five","six"],
  });
  assert.deepEqual(rows.map(row=>row.question_key), ["Stage_permission","a b","a b"]);
  assert.deepEqual(rows.map(row=>row.label), ["four","five","six"]);
  assert.deepEqual(rows.map(row=>row.clientId), rows.map(row=>row.question_key));
});

test("MIG-0652 U01: CURRENT type fallback and option normalization, 50-cap, emoji edge", () => {
  const long = "x".repeat(199) + "😀"; // orphan UTF-16 high surrogate at index 200
  const options = [long, long, ...Array.from({length:60}, (_,i)=>"option"+i)].join("\n");
  const [row] = read({
    general_custom_questions_present:"1",
    general_custom_question_key:"valid",
    general_custom_question_type:"invalid-type",
    general_custom_question_options:options,
  });
  assert.equal(row.type,"textarea");
  assert.equal(row.options.length,50);
  assert.equal(row.options[0], "x".repeat(199));
  assert.equal(row.options[49], "option48");
  assert.deepEqual(row.options, normalizeOptionList(options.split(/\r?\n/)));
});

test("MIG-0652 U01: missing trailing columns preserve CURRENT empty and false defaults", () => {
  const rows = read({ general_custom_questions_present:"1",
    general_custom_question_key:["alpha","beta"] });
  assert.deepEqual(rows, ["alpha","beta"].map(key=>({
    clientId:key,question_key:key,label:"",description:"",type:"textarea",
    required:false,options:[],placeholder:"",enabled:false,
  })));
});

test("MIG-0652 U01: CURRENT adapter stays thin and domain has no Next/Drizzle imports", async () => {
  const current = await readFile(new URL("../../../src/lib/event/generalCustomQuestionDraft.ts", import.meta.url),"utf8");
  const core = await readFile(new URL("../src/event/generalQuestionForm.ts", import.meta.url),"utf8");
  assert.match(current,/return readGeneralCustomQuestionsFromFormDataCore\(formData, \{/);
  assert.match(current,/return generalCustomQuestionsPresentCore\(formData\)/);
  for (const name of ["parseQuestionType","normalizeOptionList","isStagePermissionQuestionKey"]) {
    assert.match(current,new RegExp(name+","));
  }
  assert.doesNotMatch(core,/from ["']@\//);
  assert.doesNotMatch(current,/formData\.getAll\("general_custom_question_key"\)/);
});
