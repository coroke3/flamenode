import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { dom } from "./helpers.mjs";

const { SetActiveXButton } = await import("../.test-dist/apps/app/src/routes/dashboard/settings/XIdPanelActions.js");
const { isMountedPersonalPath, PERSONAL_READ_PATHS, personalDocumentNavigation } =
  await import("../.test-dist/apps/app/src/routes/personalPaths.js");

function LocationProbe() {
  const loc = useLocation();
  return React.createElement("output", { "data-testid": "location" }, loc.pathname + loc.search + loc.hash);
}
async function exercise(next, result = { ok: true }) {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  let refreshed = 0;
  const assigned = [];
  const original = personalDocumentNavigation.assign;
  personalDocumentNavigation.assign = to => assigned.push(to);
  try {
    await act(async () => root.render(React.createElement(MemoryRouter, {
      initialEntries: ["/dashboard/settings"],
    }, React.createElement(SetActiveXButton, {
      api: { setActive: async () => result }, xUserId: "alpha",
      approved: true, next, onRefresh: () => { refreshed++; },
    }), React.createElement(LocationProbe))));
    await act(async () => container.querySelector("button").click());
    await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
    return { pathname: container.querySelector("output").textContent, assigned, refreshed };
  } finally {
    await act(async () => root.unmount());
    container.remove();
    personalDocumentNavigation.assign = original;
  }
}

test("SEC-897: mounted Personal paths are the only client-route targets", () => {
  assert.deepEqual([...PERSONAL_READ_PATHS], [
    "/dashboard", "/dashboard/library", "/dashboard/settings",
    "/dashboard/youtube-playlists", "/onboarding", "/entry",
  ]);
  for (const path of PERSONAL_READ_PATHS) {
    assert.equal(isMountedPersonalPath(path + "?v=1#after"), true);
    assert.equal(isMountedPersonalPath(path + "/unmounted"), false);
  }
  for (const path of ["/entry/slotted", "/entry/unslotted", "/dashboard/edit/v1/permissions",
    "/admin/videos/v1", "/rules", "/dashboarding"]) {
    assert.equal(isMountedPersonalPath(path), false);
  }
});

test("SEC-897: successful Active X switch routes mounted paths through MemoryRouter", async () => {
  for (const next of ["/dashboard/library?tab=all#top", "/dashboard/youtube-playlists?x=1"]) {
    const result = await exercise(next);
    assert.deepEqual(result, { pathname: next, assigned: [], refreshed: 0 });
  }
});

test("SEC-897: successful Active X switch leaves SPA for unmounted paths", async () => {
  for (const next of ["/entry/slotted?slot_id=s1#part", "/entry/unslotted",
    "/dashboard/edit/v1/permissions?privileged=admin", "/admin/videos/v1", "/rules"]) {
    const result = await exercise(next);
    assert.deepEqual(result, { pathname: "/dashboard/settings", assigned: [next], refreshed: 0 });
  }
});

test("SEC-897: invalid or absent next only refreshes; failed mutation never navigates", async () => {
  for (const next of [undefined, null, "//evil.example", "https://evil.example",
    "/" + "a".repeat(512)]) {
    assert.deepEqual(await exercise(next), {
      pathname: "/dashboard/settings", assigned: [], refreshed: 1,
    });
  }
  assert.deepEqual(await exercise("/admin/videos/v1", { ok: false, message: "not approved" }), {
    pathname: "/dashboard/settings", assigned: [], refreshed: 0,
  });
});
