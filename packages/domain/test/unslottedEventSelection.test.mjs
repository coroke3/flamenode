import test from "node:test";
import assert from "node:assert/strict";
import {
  parseUnslottedEventIdFromForm,
  UnslottedEventSyncError,
} from "@flamenode/domain/video";
import {
  parseUnslottedEventIdFromForm as legacyParse,
  UnslottedEventSyncError as LegacyError,
} from "../../../src/lib/video/resolveUnslottedEventSyncTarget.ts";

const selection=(value)=> {
  const form=new FormData();
  if(value!==undefined)form.set("event_ids",value);
  return form;
};
const invalid=(form)=>{
  assert.throws(()=>parseUnslottedEventIdFromForm(form),(error)=>
    error instanceof UnslottedEventSyncError &&
    error.name==="UnslottedEventSyncError" &&
    error.code==="unslotted_event_selection_invalid");
};

test("MIG-0651: legacy and domain selection contracts are identical",()=>{
  assert.strictEqual(legacyParse,parseUnslottedEventIdFromForm);
  assert.strictEqual(LegacyError,UnslottedEventSyncError);
  const notAllowed=new UnslottedEventSyncError("unslotted_event_not_allowed");
  assert.equal(notAllowed.message,"unslotted_event_not_allowed");
  assert.equal(notAllowed.name,"UnslottedEventSyncError");
  assert.equal(notAllowed.code,"unslotted_event_not_allowed");
});
test("MIG-0651: selection retains CURRENT absent/empty/single event behavior",()=>{
  assert.equal(parseUnslottedEventIdFromForm(selection()),null);
  assert.equal(parseUnslottedEventIdFromForm(selection("")),null);
  assert.equal(parseUnslottedEventIdFromForm(selection("  ")),null);
  assert.equal(parseUnslottedEventIdFromForm(selection(" event-a ")), "event-a");
  assert.equal(parseUnslottedEventIdFromForm(selection("event-a,event-a")), "event-a");
  assert.equal(parseUnslottedEventIdFromForm(selection(", event-a , , event-a ,")), "event-a");
  assert.equal(parseUnslottedEventIdFromForm(selection("a".repeat(64))),"a".repeat(64));
});
test("MIG-0651: multiple unique IDs and oversized IDs stay fail-closed",()=>{
  invalid(selection("event-a,event-b"));
  invalid(selection("a".repeat(65)));
  invalid(selection("a".repeat(65)+",ok"));
  // CURRENT rejects the entire selection when any ID is oversized, even
  // if another valid ID follows; do not silently filter like list parsing.
  invalid(selection("ok,"+"a".repeat(65)));
  invalid(selection("event-a, event-b, event-a"));
});
test("MIG-0651: File input remains invalid instead of becoming an empty selection",()=>{
  const form=new FormData();
  form.set("event_ids",new Blob(["event-a"]), "selection.txt");
  invalid(form);
});
