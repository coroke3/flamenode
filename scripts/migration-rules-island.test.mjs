// MIG-0519 T01-T04: CURRENT /rules contract and the build-time JS-off fallback.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { RulesView } from "../packages/ui/src/screens/RulesView.tsx";
import { sanitizeNextPath } from "../src/lib/utils/next.ts";
import { guardRedirect } from "../apps/site/src/lib/guardRedirect.ts";
import { acceptLatestTerms } from "../apps/site/src/lib/terms.ts";
import { RULES_COMMIT_ERROR, RULES_GENERIC_ERROR, RULES_RETRY_MESSAGE, rulesErrorMessage, submitRulesConsent } from "../apps/site/src/components/RulesConsentIsland.ts";

const mkFetch = (status, body, onCall) => async (url, options) => {
  onCall?.(url, options);
  return { ok: status >= 200 && status < 300, status, json: async () => body };
};

test("T01: CURRENT three error-code branches are unchanged", () => {
  assert.equal(rulesErrorMessage(null), null);
  assert.equal(rulesErrorMessage("concurrent_update"), RULES_RETRY_MESSAGE);
  assert.equal(rulesErrorMessage("database_unavailable"), RULES_RETRY_MESSAGE);
  assert.equal(rulesErrorMessage("terms_commit_failed"), RULES_COMMIT_ERROR);
  assert.equal(rulesErrorMessage("unexpected"), RULES_GENERIC_ERROR);
  assert.ok(fs.readFileSync("app/(public)/rules/page.tsx", "utf8").includes(RULES_RETRY_MESSAGE));
  assert.ok(fs.readFileSync("app/(public)/rules/page.tsx", "utf8").includes(RULES_COMMIT_ERROR));
  assert.ok(fs.readFileSync("app/(public)/rules/page.tsx", "utf8").includes(RULES_GENERIC_ERROR));
});

test("T01: accepted POST preserves CURRENT hidden next and navigates using server next", async () => {
  let sent;
  const fetcher = mkFetch(200, { ok: true, next: "/x" }, (url, options) => { sent = { url, options }; });
  assert.deepEqual(await submitRulesConsent("/x", fetcher), { navigate: "/x" });
  assert.equal(sent.url, "/api/personal/terms/accept");
  assert.equal(sent.options.method, "POST");
  assert.equal(sent.options.credentials, "same-origin");
  assert.equal(sent.options.cache, "no-store");
  assert.deepEqual(JSON.parse(sent.options.body), { next: "/x" });
  assert.equal(sent.options.headers["Content-Type"], "application/json");
});

test("T02: unsafe next and server-selected URL never cause open redirects", async () => {
  for (const value of ["https://evil.example/path", "//evil.example", "/\\evil", "javascript:alert(1)", "/a\n"]) {
    let body;
    const fetcher = mkFetch(200, { ok: true, next: "/dashboard" }, (_url, options) => { body = JSON.parse(options.body); });
    assert.deepEqual(await submitRulesConsent(value, fetcher), { navigate: "/dashboard" });
    assert.equal(body.next, sanitizeNextPath(value));
  }
  assert.equal(guardRedirect("//evil.example"), null);
  assert.equal(guardRedirect("https://evil.example"), null);
  assert.equal(guardRedirect("/event/x?next=%2F"), "/event/x?next=%2F");
  assert.deepEqual(await submitRulesConsent("/x", mkFetch(200, { ok: true, next: "//evil.example" })), { error: RULES_GENERIC_ERROR });
});

test("T03: failed accept follows existing safe redirect, otherwise shows message and stays on form", async () => {
  assert.deepEqual(await submitRulesConsent("/x", mkFetch(409, { ok: false, next: "/rules?next=%2Fx&error=concurrent_update" })), { navigate: "/rules?next=%2Fx&error=concurrent_update" });
  assert.deepEqual(await submitRulesConsent("/x", mkFetch(401, { ok: false, next: "/entry?next=%2Fx" })), { navigate: "/entry?next=%2Fx" });
  assert.deepEqual(await submitRulesConsent("/x", mkFetch(503, { ok: false, message: "混雑しています。" })), { error: "混雑しています。" });
  assert.deepEqual(await submitRulesConsent("/x", mkFetch(200, { ok: false, message: "再試行してください。" })), { error: "再試行してください。" });
  assert.deepEqual(await submitRulesConsent("/x", async () => { throw new Error("db details"); }), { error: RULES_COMMIT_ERROR });
  assert.deepEqual(await submitRulesConsent("/x", mkFetch(200, { next: "/x" })), { error: RULES_COMMIT_ERROR });
  assert.deepEqual(await submitRulesConsent("/x", mkFetch(503, { ok: true, next: "/x" })), { error: RULES_COMMIT_ERROR });
  await assert.rejects(() => acceptLatestTerms("/x", mkFetch(200, { ok: true, next: 42 })), /Invalid terms next/);
});

test("T04: static legal page has no dead consent control without JS", () => {
  const html = renderToStaticMarkup(React.createElement(RulesView, {
    versionLabel: "v1", blocks: [{ type: "paragraph", text: "本文" }], showConsentMount: true,
  }));
  const doc = new JSDOM(html).window.document;
  assert.ok(doc.querySelector("article")?.textContent.includes("本文"));
  assert.ok(doc.querySelector("#rules-consent-mount"));
  assert.equal(doc.querySelector("form"), null);
  assert.equal(doc.querySelector("button"), null);
  assert.ok(doc.querySelector("#event-host"));
  const astro = fs.readFileSync("apps/site/src/pages/rules.astro", "utf8");
  assert.match(astro, /showConsentMount=\{true\}/);
  assert.match(astro, /mountRulesConsent\(\)/);
});
