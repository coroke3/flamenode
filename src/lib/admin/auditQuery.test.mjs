import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAuditViewHref,
  readAuditActorFilter,
  readAuditLimit,
  readAuditQueryValue,
  readAuditViewMode,
} from "./auditQuery.ts";

test("CURRENT audit: single-valued filters retain trim and view compatibility", () => {
  assert.equal(readAuditQueryValue(" events "), "events");
  assert.equal(readAuditQueryValue(""), "");
  assert.equal(readAuditQueryValue(undefined), "");
  assert.equal(readAuditViewMode("timeline"), "timeline");
  assert.equal(readAuditViewMode(" timeline "), "table");
  assert.equal(readAuditViewMode("cards "), "table");
  assert.equal(readAuditViewMode(["cards"]), "table");
  assert.equal(readAuditViewMode("cards"), "cards");
  assert.equal(readAuditViewMode("unknown"), "table");
});

test("CURRENT audit: repeated query keys cannot throw or become comma-separated filters", () => {
  for (const raw of [["events", "users"], [""], []]) {
    assert.equal(readAuditQueryValue(raw), "");
    assert.equal(readAuditViewMode(raw), "table");
    assert.equal(readAuditLimit(raw), 50);
  }
});

test("CURRENT audit: limit is always within 1–100 after flooring", () => {
  for (const [raw, expected] of [
    [undefined, 50], ["", 50], ["0", 50], ["-1", 50],
    [" 25.9 ", 25], ["100", 100], ["101", 100],
    ["0.1", 1], ["0.999", 1], ["1e-99", 1], ["1", 1], ["1.999", 1],
    ["NaN", 50], ["Infinity", 50], ["1e309", 50],
    [["10", "80"], 50],
  ]) {
    assert.equal(readAuditLimit(raw), expected, String(raw));
  }
});

test("CURRENT audit: view switches retain only single-valued filters and replace view", () => {
  const href = buildAuditViewHref({
    table: "events",
    operation: ["CREATE", "DELETE"],
    actor: "a&b",
    operator: undefined,
    since: "2026-11-01",
    view: ["table", "cards"],
    limit: ["50", "100"],
  }, "timeline");
  const url = new URL(href, "https://flamenode.net");
  assert.equal(url.pathname, "/admin/audit");
  assert.equal(url.searchParams.get("view"), "timeline");
  assert.equal(url.searchParams.get("table"), "events");
  assert.equal(url.searchParams.get("actor"), "a&b");
  assert.equal(url.searchParams.get("since"), "2026-11-01");
  assert.equal(url.searchParams.has("operation"), false);
  assert.equal(url.searchParams.has("limit"), false);
  assert.equal(url.searchParams.getAll("view").length, 1);
});

test("CURRENT audit: bookmarked operator alias stays a normal single-value query", () => {
  const href = buildAuditViewHref({ operator: "old-id", record: "v1" }, "cards");
  const url = new URL(href, "https://flamenode.net");
  assert.equal(url.searchParams.get("operator"), "old-id");
  assert.equal(url.searchParams.get("record"), "v1");
  assert.equal(url.searchParams.get("view"), "cards");
});

test("CURRENT audit: duplicate actor falls back to single-valued legacy operator without widening the audit query", () => {
  assert.equal(readAuditActorFilter(["a", "b"], "legacy-id"), "legacy-id");
  assert.equal(readAuditActorFilter(["a", "b"], ["one", "two"]), "");
  assert.equal(readAuditActorFilter("modern-id", "legacy-id"), "modern-id");
  assert.equal(readAuditActorFilter("", "legacy-id"), "");
  assert.equal(readAuditActorFilter(undefined, "legacy-id"), "legacy-id");
  assert.equal(readAuditActorFilter(["a", "b"], undefined), "");
});
