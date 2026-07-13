import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveManageEventNav } from "./eventNavigation.ts";

function nav(pathname, search = "", eventId = "ev1") {
  return resolveManageEventNav({
    pathname,
    searchParams: new URLSearchParams(search),
    eventId,
  });
}

test("/videos?status=pending → pending", () => {
  assert.equal(nav("/manage/events/ev1/videos", "status=pending"), "pending");
});

test("/videos?status=all → content", () => {
  assert.equal(nav("/manage/events/ev1/videos", "status=all"), "content");
});

test("/slots → content", () => {
  assert.equal(nav("/manage/events/ev1/slots"), "content");
});

test("/audience → content", () => {
  assert.equal(nav("/manage/events/ev1/audience"), "content");
});

test("/edit → settings", () => {
  assert.equal(nav("/manage/events/ev1/edit"), "settings");
});

test("/staff → settings", () => {
  assert.equal(nav("/manage/events/ev1/staff"), "settings");
});
