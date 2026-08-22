import assert from "node:assert/strict";
import test from "node:test";
import { submitFormCompat } from "./submitFormCompat.ts";

test("submitFormCompat uses requestSubmit with the form as this", () => {
  const calls = [];
  const form = {
    requestSubmit() {
      calls.push(this);
    },
  };

  submitFormCompat(form);

  assert.deepEqual(calls, [form]);
});

test("submitFormCompat validates before the legacy submit event", () => {
  const calls = [];
  const form = {
    checkValidity() {
      calls.push("check");
      return false;
    },
    reportValidity() {
      calls.push("report");
    },
    dispatchEvent() {
      calls.push("dispatch");
      return true;
    },
  };

  submitFormCompat(form);

  assert.deepEqual(calls, ["check", "report"]);
});

test("submitFormCompat dispatches a cancelable submit event for valid legacy forms", () => {
  let event = null;
  const form = {
    checkValidity() {
      return true;
    },
    dispatchEvent(nextEvent) {
      event = nextEvent;
      return true;
    },
  };

  submitFormCompat(form);

  assert.equal(event?.type, "submit");
  assert.equal(event?.bubbles, true);
  assert.equal(event?.cancelable, true);
});
