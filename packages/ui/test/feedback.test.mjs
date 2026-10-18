import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Button,
  EmptyState,
  ErrorCallout,
  FEEDBACK_MESSAGES,
  PartialFailureNotice,
  StatusNotice,
} from "../dist/index.js";

const h = React.createElement;
const html = (el) => renderToStaticMarkup(el);
const current = (file) => fs.readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8");

test("T01: ErrorCallout is an assertive alert with a retry button that calls retry", () => {
  let retried = 0;
  const element = h(ErrorCallout, { message: "通信エラーが発生しました", retry: () => { retried += 1; }, retryLabel: "再試行する" });
  const out = html(element);
  assert.match(out, /role="alert"/);
  assert.match(out, /aria-live="assertive"/);
  assert.match(out, /通信エラーが発生しました/);
  assert.match(out, /<button[^>]*class="[^"]*fn-error-retry[^"]*"[^>]*>再試行する<\/button>/);
  // the rendered Button wires its click to retry
  const button = ErrorCallout({ message: "x", retry: () => { retried += 1; } }).props.children.at(-1);
  Button(button.props).props.onClick({ preventDefault() {} });
  assert.equal(retried, 1);
});

test("ErrorCallout keeps CURRENT reason → CTA and tone, and renders nothing without reason and message", () => {
  assert.equal(html(h(ErrorCallout, {})), "");
  const login = html(h(ErrorCallout, { reason: "unauthenticated", currentPath: "/event/a?tab=slots" }));
  assert.match(login, /href="\/entry\?next=%2Fevent%2Fa%3Ftab%3Dslots"[^>]*>ログイン</);
  assert.match(login, /エラーが発生しました/, "CURRENT fallback text");
  assert.match(login, /data-tone="danger"/);
  const tos = html(h(ErrorCallout, { reason: "tos_required", currentPath: "/entry" }));
  assert.match(tos, /href="\/onboarding\?next=%2Fentry"[^>]*>利用規約を確認</);
  assert.match(tos, /data-tone="warning"/);
  assert.match(html(h(ErrorCallout, { reason: "active_x_not_approved", currentPath: "/" })), />初期設定を続ける</);
  assert.match(html(h(ErrorCallout, { reason: "duplicate_youtube_id" })), /href="\/list"[^>]*>既存作品を探す</);
  assert.match(
    html(h(ErrorCallout, { reason: "submitter_change_denied", currentPath: "/manage/v?x=1#m" })),
    /href="\/manage\/v\?x=1&amp;privileged=admin#m"[^>]*>管理者モードに切替</,
  );
  for (const reason of ["banned", "maintenance_mode", "cost_guard_blocked"]) {
    assert.doesNotMatch(html(h(ErrorCallout, { reason, currentPath: "/" })), /<a /, `${reason}: explanation only`);
  }
  assert.match(html(h(ErrorCallout, { reason: "maintenance_mode" })), /data-tone="warning"/);
  assert.match(html(h(ErrorCallout, { message: "m", extraCta: { href: "/help", label: "ヘルプ" } })), /href="\/help"/);
});

test("T02: the shared state texts are CURRENT's", () => {
  assert.ok(current("src/lib/staticRebuild/publicReflectionNotice.ts").includes(`"${FEEDBACK_MESSAGES.reflectionPending}"`));
  assert.ok(current("src/components/ui/DataUnavailableNotice.tsx").includes(`"${FEEDBACK_MESSAGES.dataUnavailable}"`));
  assert.ok(current("src/components/ui/PartialFailureNotice.tsx").includes(`"${FEEDBACK_MESSAGES.partialFailure}"`));
  assert.ok(current("src/components/ui/ErrorCallout.tsx").includes(`"${FEEDBACK_MESSAGES.error}"`));
  // JSX joins its two text lines with one space.
  const banner = current("src/components/layout/PublicDegradedBanner.tsx");
  const text = banner.match(/<span>([\s\S]*?)<\/span>/)[1].trim().split(/\s*\n\s*/).join(" ");
  assert.equal(FEEDBACK_MESSAGES.degraded, text);
  assert.ok(banner.includes(`<strong>${FEEDBACK_MESSAGES.degradedTitle}</strong>`));
});

test("U01: degraded, pending, success and unavailable are polite status notices with CURRENT defaults", () => {
  const degraded = html(h(StatusNotice, { status: "degraded" }));
  assert.match(degraded, /role="status"/);
  assert.match(degraded, /aria-live="polite"/);
  assert.ok(degraded.includes(FEEDBACK_MESSAGES.degradedTitle) && degraded.includes(FEEDBACK_MESSAGES.degraded));
  assert.ok(html(h(StatusNotice, { status: "pending" })).includes(FEEDBACK_MESSAGES.reflectionPending));
  assert.ok(html(h(StatusNotice, { status: "unavailable" })).includes(FEEDBACK_MESSAGES.dataUnavailable));
  const success = html(h(StatusNotice, { status: "success", message: "設定を保存しました" }));
  assert.match(success, /fn-status-notice--success/);
  assert.match(success, /設定を保存しました/);
});

test("PartialFailureNotice follows CURRENT: alert with the failed items, nothing without items", () => {
  assert.equal(html(h(PartialFailureNotice, { items: [] })), "");
  const out = html(h(PartialFailureNotice, { items: ["サムネイル", "通知"] }));
  assert.match(out, /role="alert"/);
  assert.ok(out.includes(FEEDBACK_MESSAGES.partialFailure));
  assert.match(out, /<li>サムネイル<\/li><li>通知<\/li>/);
});

test("EmptyState renders title, description, CURRENT action variants and tone", () => {
  const out = html(h(EmptyState, {
    title: "作品がまだありません",
    description: "最初の作品を投稿してみましょう",
    tone: "warning",
    actions: [{ href: "/entry", label: "投稿する" }, { href: "/list", label: "一覧へ", variant: "ghost" }],
  }));
  assert.match(out, /fn-empty-state--warning/);
  assert.match(out, /<h2[^>]*>作品がまだありません<\/h2>/);
  assert.match(out, /最初の作品を投稿してみましょう/);
  assert.match(out, /href="\/entry" class="fn-btn fn-btn--primary"/);
  assert.match(out, /href="\/list" class="fn-btn fn-btn--tertiary"/);
  assert.doesNotMatch(out, /aria-label=/, "CURRENT does not make each empty state a landmark");
});

test("an icon-only Button without an accessible name is rejected (MIG-0202 carry-over)", () => {
  const icon = h("svg");
  assert.throws(() => html(h(Button, { icon })), /icon-only button needs aria-label/);
  assert.match(html(h(Button, { icon, "aria-label": "閉じる" })), /aria-label="閉じる"/);
  assert.match(html(h(Button, { icon }, "閉じる")), />閉じる</);
});
