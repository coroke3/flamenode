import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  GENERAL_CUSTOM_QUESTION_TYPE_LABELS,
  createEmptyGeneralCustomQuestion,
  customQuestionToDraft,
  generalCustomQuestionsPresent,
  readGeneralCustomQuestionsFromFormData,
} from "../.test-dist/apps/ops/src/lib/event/generalCustomQuestionDraft.js";
import {
  MAX_QUESTION_OPTIONS, OPTION_MAX_LEN, normalizeOptionList, parseQuestionType,
} from "../.test-dist/apps/ops/src/lib/event/customQuestions.js";

test("MIG-0721 custom question editor helper preserves CURRENT implementation", () => {
  const current = readFileSync(new URL("../../../src/lib/event/generalCustomQuestionDraft.ts", import.meta.url), "utf8");
  const port = readFileSync(new URL("../src/lib/event/generalCustomQuestionDraft.ts", import.meta.url), "utf8");
  const adapted = current
    .replace('} from "@/lib/video/customQuestions";','} from "./customQuestions.js";')
    .replace('import { isStagePermissionQuestionKey } from "@/lib/video/formSettings";','import { isStagePermissionQuestionKey } from "./formSettings.js";')
    .replace('import { generateId } from "@/lib/utils/id";','import { generateId } from "./id.js";');
  assert.ok(port.includes(adapted.trimEnd()));
  const originalId = readFileSync(new URL("../../../packages/server-core/src/id.ts", import.meta.url), "utf8");
  const idPort = readFileSync(new URL("../src/lib/event/id.ts", import.meta.url), "utf8");
  assert.ok(idPort.includes(originalId.trimEnd()));
  const originalOptions = readFileSync(new URL("../../../src/lib/video/customQuestions.ts", import.meta.url), "utf8");
  const optionHelpers = readFileSync(new URL("../src/lib/event/customQuestions.ts", import.meta.url), "utf8");
  const pureImpl = originalOptions.slice(originalOptions.indexOf("const VALID_TYPES:"), originalOptions.indexOf("export function rowToQuestion("));
  assert.ok(optionHelpers.includes(pureImpl.trimEnd()));
});

test("MIG-0721 unknown form type and abusive option payload are bounded like CURRENT", () => {
  assert.equal(parseQuestionType("bogus"), "textarea");
  assert.equal(parseQuestionType("select"), "select");
  assert.equal(MAX_QUESTION_OPTIONS, 50);
  assert.equal(OPTION_MAX_LEN, 200);
  const normalized = normalizeOptionList([" keep ", "keep", "", "  ", "\uD83D", "x".repeat(250)]);
  assert.deepEqual(normalized, ["keep", "x".repeat(200)]);
  assert.equal(normalizeOptionList(Array.from({length: 60}, (_,i) => `choice-${i}`)).length, 50);
});

test("MIG-0721 disabled or absent custom question presence flag never yields mutations", () => {
  const form = new FormData();
  form.set("general_custom_question_key", "q1");
  form.set("general_custom_question_label", "秘密の質問");
  assert.equal(generalCustomQuestionsPresent(form), false);
  assert.deepEqual(readGeneralCustomQuestionsFromFormData(form), []);
});

test("MIG-0721 parser ignores reserved stage keys, normalizes option lists and preserves order", () => {
  const form = new FormData();
  form.set("general_custom_questions_present", "1");
  for (const [key,enabled,label,type,required,options] of [
    ["stage_permission","1","reserved","text","0",""],
    ["q2","1"," 質問2 ","select","1","A\n A \nB\n"],
    ["q3","0","質問3","unexpected","0",""],
  ]) {
    form.append("general_custom_question_key", key);
    form.append("general_custom_question_enabled", enabled);
    form.append("general_custom_question_label", label);
    form.append("general_custom_question_type", type);
    form.append("general_custom_question_required", required);
    form.append("general_custom_question_options", options);
  }
  const rows = readGeneralCustomQuestionsFromFormData(form);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(x=>x.question_key), ["q2","q3"]);
  assert.equal(rows[0].label,"質問2");
  assert.equal(rows[0].required,true);
  assert.equal(rows[0].enabled,true);
  assert.deepEqual(rows[0].options,["A","B"]);
  assert.equal(rows[1].type,"textarea");
  assert.equal(rows[1].enabled,false);
});

test("MIG-0721 new question IDs are unique and not the reserved stage key", () => {
  const a = createEmptyGeneralCustomQuestion(0);
  const b = createEmptyGeneralCustomQuestion(1);
  assert.ok(a.question_key.startsWith("q_"));
  assert.ok(b.clientId.startsWith("gq_"));
  assert.notEqual(a.question_key,b.question_key);
  assert.equal(a.type,"textarea");
  assert.equal(a.enabled,true);
  assert.equal(GENERAL_CUSTOM_QUESTION_TYPE_LABELS.checkbox,"チェックボックス");
});

test("MIG-0721 persisted question maps to editor draft without losing privacy-sensitive options", () => {
  const saved={id:"id-1",event_id:"e1",question_key:"private-q",label:"質問",description:null,
    type:"radio",required:true,options:["選択A","選択B"],placeholder:null,
    max_length:null,sort_order:0,is_active:false,visibility:"private"};
  const copy=customQuestionToDraft(saved);
  assert.deepEqual(copy,{
    clientId:"id-1",question_key:"private-q",label:"質問",description:"",
    type:"radio",required:true,options:["選択A","選択B"],placeholder:"",enabled:false,
  });
});
