import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { EventCustomQuestionsEditor } from "../.test-dist/apps/ops/src/components/event/EventCustomQuestionsEditor.js";
import { CustomQuestionFields } from "../.test-dist/apps/ops/src/components/event/CustomQuestionFields.js";
import { editorCss, fieldCss } from "../.test-dist/apps/ops/src/components/event/eventCustomQuestionsStyles.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {url:"https://flamenode.test/admin/events/new"});
for (const key of ["window","document","navigator","HTMLElement","Node","Event","MouseEvent"]) {
  Object.defineProperty(globalThis,key,{configurable:true,value:dom.window[key]});
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const q=(n,type="select")=>({
  clientId:"client-"+n,question_key:"q_"+n,label:"質問"+n,
  description:"",type,required:false,options:["A","B"],placeholder:"",
  enabled:true,
});
async function mount(element) {
  const node=document.createElement("div");document.body.append(node);
  const root=createRoot(node);
  await React.act(async()=>root.render(element));
  return {node, async close(){await React.act(async()=>root.unmount());node.remove();}};
}

test("MIG-0721 editor SSR keeps CURRENT fields and option serialization",()=>{
  const html=renderToStaticMarkup(React.createElement(EventCustomQuestionsEditor,{
    questions:[q(1)], disabled:false,onChange(){},
  }));
  for(const name of ["general_custom_questions_present","general_custom_question_key","general_custom_question_enabled","general_custom_question_required","general_custom_question_type","general_custom_question_options","general_custom_question_label","general_custom_question_description","general_custom_question_placeholder"]){
    assert.match(html,new RegExp('name="'+name+'"'));
  }
  const document = new JSDOM(html).window.document;
  assert.equal(document.querySelector(\'input[name="general_custom_question_options"]\').value, "A\\nB");
  assert.match(html,/カスタム質問を追加/);
  assert.match(html,/投稿時の見え方/);
  assert.match(html,/選択肢を追加/);
  assert.match(html,/maxLength="120"/i);
});

test("MIG-0721 editor honors 4-question cap and disables destructive operations",()=>{
  const many=[q(1),q(2),q(3),q(4)];
  const html=renderToStaticMarkup(React.createElement(EventCustomQuestionsEditor,{
    questions:many,disabled:false,onChange(){},
  }));
  assert.match(html,/カスタム質問は最大4件です/);
  const document = new JSDOM(html).window.document;
  assert.equal([...document.querySelectorAll("button")].find(b=>b.textContent.includes("カスタム質問を追加")).disabled, true);
  const disabled=renderToStaticMarkup(React.createElement(EventCustomQuestionsEditor,{
    questions:[q(1)],disabled:true,onChange(){},
  }));
  assert.match(disabled,/readOnly=""/);
  assert.match(disabled,/disabled=""/);
});

test("MIG-0721 editor adds questions and emits unique safely generated keys",async()=>{
  let latest=[];
  function Wrapper(){const [questions,setQuestions]=React.useState([]);latest=questions;return React.createElement(EventCustomQuestionsEditor,{questions,disabled:false,onChange:setQuestions});}
  const ui=await mount(React.createElement(Wrapper));
  try {
    const add=()=>[...ui.node.querySelectorAll("button")].find(b=>b.textContent.includes("カスタム質問を追加"));
    await React.act(async()=>add().click());
    assert.equal(latest.length,1);
    assert.match(latest[0].question_key,/^q_[a-z0-9-]+$/i);
    await React.act(async()=>add().click());
    assert.equal(latest.length,2);
    assert.notEqual(latest[0].question_key,latest[1].question_key);
  }finally{await ui.close();}
});

test("MIG-0721 editor reorder/delete/duplicate match CURRENT interactions",async()=>{
  let latest=[q(1),q(2)];
  function Wrapper(){const [questions,setQuestions]=React.useState(latest);latest=questions;return React.createElement(EventCustomQuestionsEditor,{questions,disabled:false,onChange:setQuestions});}
  const ui=await mount(React.createElement(Wrapper));
  try{
    const buttons=(label)=>[...ui.node.querySelectorAll("button")].filter(x=>x.textContent.includes(label));
    await React.act(async()=>buttons("下へ")[0].click());
    assert.deepEqual(latest.map(x=>x.question_key),["q_2","q_1"]);
    await React.act(async()=>buttons("複製")[0].click());
    assert.equal(latest.length,3);
    assert.notEqual(latest[2].question_key,latest[0].question_key);
    assert.equal(latest[2].label,latest[0].label);
    await React.act(async()=>buttons("削除")[0].click());
    assert.equal(latest.length,2);
  }finally{await ui.close();}
});

test("MIG-0721 custom question field preview never posts or changes inputs",()=>{
  const html=renderToStaticMarkup(React.createElement(CustomQuestionFields,{
    id:"q",name:"secret",type:"checkbox",options:["A","B"],
    values:["A"],disabled:true,preview:true,
  }));
  assert.doesNotMatch(html,/name="secret"/);
  assert.match(html,/checked=""/);
  assert.match(html,/tabIndex="-1"/);
  assert.match(html,/disabled=""/);
});

test("MIG-0721 scoped responsive CSS preserves touch and small-screen behaviors",()=>{
  assert.match(editorCss,/@media \(max-width: 640px\)/);
  assert.match(editorCss,/\.opsEventOptionRow/);
  assert.match(editorCss,/--fn-control-h-touch/);
  assert.match(fieldCss,/@media \(hover: none\)/);
  assert.match(fieldCss,/prefers-reduced-motion/);
  assert.doesNotMatch(editorCss,/\:global\(/);
  assert.doesNotMatch(fieldCss,/\:global\(/);
});
