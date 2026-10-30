import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { JSDOM } from "jsdom";
import { EventStaffReadOnlyPage } from "../.test-dist/apps/ops/src/routes/manage/EventStaffReadOnlyPage.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://flamenode.test/manage/events/a/staff",
});
for (const key of ["window", "document", "navigator", "HTMLElement", "Node"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function staff(eventId, memberName) {
  return {
    event: { id: eventId, title: "Event " + eventId, accent_color: null },
    isAdmin: false, canManageMembers: false, pendingCount: 0,
    members: [{
      id: "staff-" + eventId, x_user_id: "x_" + eventId, display_name: memberName,
      permission_preset: "public_staff", is_public: 0, public_role_label: null,
      permission_keys: [], x_name: null, icon_url: null,
    }],
    ownerCount: 0, publicCount: 0, approvedCount: 0, membersTruncated: false,
  };
}
function json(data) {
  return new Response(JSON.stringify(data), {
    status: 200, headers: { "content-type": "application/json" },
  });
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function setup() {
  const target = document.createElement("div");
  document.body.append(target);
  const root = createRoot(target);
  const requests = [];
  const fetchFn = (url, init) => {
    const item = deferred();
    requests.push({ ...item, url, signal: init?.signal });
    return item.promise;
  };
  const render = async (eventId, fetch = fetchFn) => {
    await React.act(async () => {
      root.render(React.createElement(MemoryRouter, null,
        React.createElement(EventStaffReadOnlyPage, { eventId, fetchFn: fetch })));
    });
  };
  const cleanup = async () => {
    await React.act(async () => { root.unmount(); target.remove(); });
  };
  return { target, requests, fetchFn, render, cleanup };
}

test("MIG-0723 staff identity switch hides previously displayed event members", async () => {
  const ui = setup();
  try {
    await ui.render("event-a");
    assert.match(ui.target.textContent, /読み込み中/);
    await React.act(async () => {
      ui.requests[0].resolve(json(staff("event-a", "PRIVATE_A_MEMBER")));
    });
    assert.match(ui.target.textContent, /PRIVATE_A_MEMBER/);

    await ui.render("event-b");
    assert.equal(ui.requests[0].signal.aborted, true);
    assert.doesNotMatch(ui.target.textContent, /PRIVATE_A_MEMBER/);
    assert.match(ui.target.textContent, /読み込み中/);

    await React.act(async () => {
      ui.requests[1].resolve(json(staff("event-b", "PRIVATE_B_MEMBER")));
    });
    assert.match(ui.target.textContent, /PRIVATE_B_MEMBER/);
    assert.doesNotMatch(ui.target.textContent, /PRIVATE_A_MEMBER/);
  } finally {
    await ui.cleanup();
  }
});

test("MIG-0723 late aborted response never replaces current event data", async () => {
  const ui = setup();
  try {
    await ui.render("event-a");
    await ui.render("event-b");
    assert.equal(ui.requests[0].signal.aborted, true);
    await React.act(async () => {
      ui.requests[0].resolve(json(staff("event-a", "PRIVATE_A_MEMBER")));
    });
    assert.doesNotMatch(ui.target.textContent, /PRIVATE_A_MEMBER/);
    assert.match(ui.target.textContent, /読み込み中/);
    await React.act(async () => {
      ui.requests[1].resolve(json(staff("event-b", "PRIVATE_B_MEMBER")));
    });
    assert.match(ui.target.textContent, /PRIVATE_B_MEMBER/);
  } finally {
    await ui.cleanup();
  }
});

test("MIG-0723 injected fetch identity change invalidates old authorized members", async () => {
  const ui = setup();
  try {
    await ui.render("event-a");
    await React.act(async () => {
      ui.requests[0].resolve(json(staff("event-a", "PRIVATE_OLD_MEMBER")));
    });
    assert.match(ui.target.textContent, /PRIVATE_OLD_MEMBER/);
    const second = deferred();
    await ui.render("event-a", () => second.promise);
    assert.doesNotMatch(ui.target.textContent, /PRIVATE_OLD_MEMBER/);
    assert.match(ui.target.textContent, /読み込み中/);
    await React.act(async () => {
      second.resolve(json(staff("event-a", "NEW_MEMBER")));
    });
    assert.match(ui.target.textContent, /NEW_MEMBER/);
  } finally {
    await ui.cleanup();
  }
});


test("MIG-0723 invalid UTF-16 event ID renders a failure, not endless loading", async () => {
  const ui = setup();
  try {
    await ui.render("\uD800");
    assert.equal(ui.requests.length, 0, "malformed ID must never reach API");
    assert.doesNotMatch(ui.target.textContent, /読み込み中/);
    assert.match(ui.target.textContent, /取得できませんでした/);
  } finally {
    await ui.cleanup();
  }
});
