import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { plannedGeneralQuestionsFromDraftsCore } from "@flamenode/domain/event";

function draft(overrides = {}) {
  return {
    question_key: "question", label: " Choice ", description: " description ",
    type: "text", required: true, options: [], placeholder: " placeholder ",
    enabled: true, ...overrides,
  };
}
function plan(drafts) {
  let ids = 0;
  const result = plannedGeneralQuestionsFromDraftsCore({
    eventId: "ev1", drafts, now: 100,
    createId: () => "ecq_" + ++ids,
  });
  return { result, ids };
}

test("MIG-0652 U01: insert rows preserve CURRENT columns and order", () => {
  const { result, ids } = plan([
    draft(), draft({question_key:"notes", type:"textarea",required:false,enabled:false}),
    draft({question_key:"color",type:"radio",options:[" red ","red","blue"]}),
    draft({question_key:"select",type:"select",options:["a"]}),
    draft({question_key:"checks",type:"checkbox",options:["yes"]}),
  ]);
  assert.equal(result.ok, true);
  assert.equal(ids, 5);
  if (!result.ok) return;
  assert.deepEqual(result.rows[0], {
    id:"ecq_1",event_id:"ev1",question_key:"question",
    label:"Choice",description:"description",type:"text",required:1,options_json:null,
    placeholder:"placeholder",max_length:200,sort_order:0,is_active:1,
    visibility:"review",created_at:100,updated_at:100,
  });
  assert.equal(result.rows[1].max_length, 1000);
  assert.equal(result.rows[1].required, 0);
  assert.equal(result.rows[1].is_active, 0);
  assert.deepEqual(result.rows.slice(2).map(x=>x.options_json), ['["red","blue"]','["a"]','["yes"]']);
  assert.deepEqual(result.rows.slice(2).map(x=>x.max_length), [null,null,null]);
});

test("MIG-0652 U01: zero drafts allocate zero IDs", () => {
  assert.deepEqual(plan([]), {result:{ok:true,rows:[]},ids:0});
});

test("MIG-0652 U01: missing/reserved/duplicate normalized keys and label fail", () => {
  for (const [drafts,message] of [
    [[draft({question_key:"  "})],"カスタム質問の識別子が不正です。"],
    [[draft({question_key:"stage_permission"})],"カスタム質問の識別子がステージ質問と衝突しています。"],
    [[draft({question_key:"stage_permission_a"})],"カスタム質問の識別子がステージ質問と衝突しています。"],
    [[draft({question_key:"a b"}),draft({question_key:"a_b"})],"カスタム質問の識別子が重複しています。"],
    [[draft({label:"  "})],"カスタム質問の質問名を入力してください。"],
  ]) {
    assert.deepEqual(plan(drafts).result, {ok:false,message});
  }
});

test("MIG-0652 U01: choice types require at least one nonblank option", () => {
  for(const type of ["radio","select","checkbox"]) {
    assert.deepEqual(plan([draft({type,options:[""," "]})]).result, {
      ok:false,message:"Choiceの選択肢を1件以上入力してください。",
    });
  }
});

test("MIG-0652 U01: 50 option cap, truncation/dedupe, and scalar limits", () => {
  const choices=Array.from({length:55},(_,i)=>"choice_"+i), long="a".repeat(201);
  const {result}=plan([
    draft({type:"checkbox",options:[long,long,...choices]}),
    draft({question_key:"long",label:"l".repeat(130),description:"d".repeat(1200),
      placeholder:"p".repeat(700),type:"INVALID",options:["drop"]}),
  ]);
  assert.equal(result.ok,true);
  if(!result.ok)return;
  const choicesOut=JSON.parse(result.rows[0].options_json);
  assert.equal(choicesOut.length,50);
  assert.equal(choicesOut[0],"a".repeat(200));
  assert.equal(choicesOut[49],"choice_48");
  assert.equal(result.rows[1].label.length,120);
  assert.equal(result.rows[1].description.length,1000);
  assert.equal(result.rows[1].placeholder.length,500);
  assert.equal(result.rows[1].type,"textarea");
  assert.equal(result.rows[1].options_json,null);
});

test("MIG-0652 U01: CURRENT wrapper remains ID-injected Drizzle adapter", async () => {
  const source=await readFile(new URL("../../../src/lib/event/generalCustomQuestionPlan.ts",import.meta.url),"utf8");
  assert.ok(source.includes("plannedGeneralQuestionsFromDraftsCore"));
  assert.ok(source.includes('generateId("ecq")'));
  assert.ok(source.includes("typeof eventCustomQuestions.$inferInsert"));
});
