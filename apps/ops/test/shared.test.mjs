// MIG-0707 U05c: SSR characterization of ported CURRENT shared UI.
import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { Icon } from "../.test-dist/apps/ops/src/components/shared/Icon.js";
import { EmptyState } from "../.test-dist/apps/ops/src/components/shared/EmptyState.js";
import { ConsolePanel } from "../.test-dist/apps/ops/src/components/shared/ConsolePanel.js";
import { ConsolePageHeader } from "../.test-dist/apps/ops/src/components/shared/ConsolePageHeader.js";
import { PublicReflectionDelayNotice } from "../.test-dist/apps/ops/src/components/shared/PublicReflectionDelayNotice.js";
import { SaveSuccessNotice } from "../.test-dist/apps/ops/src/components/shared/SaveSuccessNotice.js";
import { AdminResourceTabs } from "../.test-dist/apps/ops/src/components/shared/AdminResourceTabs.js";
import { AdminSectionTabs } from "../.test-dist/apps/ops/src/components/shared/AdminSectionTabs.js";
import { OpsLink } from "../.test-dist/apps/ops/src/components/shared/OpsLink.js";
import { readFileSync } from "node:fs";

const render = (element, at = "/admin/audit") =>
  renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: [at] }, element));
const h = (type, props, ...children) => React.createElement(type, props, ...children);

test("MIG-0707 T06: Icon preserves SVG glyph, title, size and aria", () => {
  const html = render(h(Icon, { name: "check", size: 11, title: "完了" }));
  assert.match(html, /width="11" height="11"/);
  assert.match(html, /aria-label="完了"/);
  assert.match(html, /<polyline points="20 6 9 17 4 12"/);
  assert.match(render(h(Icon, { name: "clock", "aria-hidden": true })), /aria-hidden="true"/);
});
test("MIG-0707 T06: OpsLink uses internal links only for Ops route space", () => {
  const html = render(h("div", null,
    h(OpsLink, { href: "/admin/health" }, "health"),
    h(OpsLink, { href: "/manage?tab=a" }, "manage"),
    h(OpsLink, { href: "/dashboard" }, "personal"),
    h(OpsLink, { href: "https://example.test/" }, "external")));
  assert.match(html, /href="\/admin\/health"/);
  assert.match(html, /href="\/manage\?tab=a"/);
  assert.match(html, /href="\/dashboard"/);
  assert.match(html, /href="https:\/\/example\.test\/"/);
});
test("MIG-0707 T06: ConsolePanel preserves CURRENT variants and heading semantics", () => {
  const html = render(h(ConsolePanel, { title: "確認", tone: "danger", compact: true, separated: true, className: "extra" }, "内容"));
  assert.match(html, /fn-console-panel fn-console-panel--separated fn-console-panel--compact fn-console-panel--danger extra/);
  assert.match(html, /<h2 class="fn-console-panel-title">確認<\/h2>内容/);
});
test("MIG-0707 T06: EmptyState uses prefixed CURRENT CSS and the same accessible actions", () => {
  const html = render(h(EmptyState, { title: "空です", description: "説明", tone: "warning", actions: [
    { href: "/admin/audit", label: "監査" }, { href: "/", label: "戻る", variant: "ghost" },
  ] }));
  assert.match(html, /fn-empty-state empty-empty empty-tone-warning/);
  assert.match(html, /class="empty-icon" aria-hidden="true"/);
  assert.match(html, /<h2 class="empty-title">空です<\/h2>/);
  assert.match(html, /href="\/admin\/audit" class="fn-btn fn-btn-primary"/);
  assert.match(html, /href="\/" class="fn-btn fn-btn-ghost"/);
});
test("MIG-0707 T06: ConsolePageHeader preserves accent, actions, back link", () => {
  const html = render(h(ConsolePageHeader, { title: "配信", description: "詳細", accent: true,
    backHref: "/dashboard", actions: [{ href: "/manage/events", label: "戻す", variant: "danger" }],
  }));
  assert.match(html, /fn-console-head manage-event-hero/);
  assert.match(html, /href="\/dashboard"/);
  assert.match(html, /href="\/manage\/events" class="fn-btn fn-btn-danger fn-btn-sm"/);
  assert.match(html, /<h1 class="fn-console-title">配信<\/h1>/);
});
test("MIG-0707 T06: notices preserve CURRENT delay wording and conditional status", () => {
  const current = readFileSync(new URL("../../../src/lib/staticRebuild/publicReflectionNotice.ts", import.meta.url), "utf8");
  const canonical = current.match(/"公開ページへの反映は[^"]+"/)?.[0];
  assert.ok(canonical, "CURRENT message absent");
  const delay = render(h(PublicReflectionDelayNotice));
  assert.ok(delay.includes(JSON.parse(canonical)), "delay text changed from CURRENT");
  const saved = render(h(SaveSuccessNotice, { message: "保存済", pendingPublicReflection: true }));
  assert.match(saved, /role="status" class="fn-success"/);
  assert.ok(saved.includes(JSON.parse(canonical)));
  const ordinary = render(h(SaveSuccessNotice, { message: "保存済", pendingPublicReflection: false }));
  assert.ok(!ordinary.includes(JSON.parse(canonical)));
});
test("MIG-0707 T06: Admin tabs preserve hub labels, pathname and aria-current", () => {
  const html = render(h(AdminResourceTabs, { tabs: [
    { key: "audit", href: "/admin/audit", label: "監査ログ", icon: "clock" },
    { key: "users", href: "/admin/users", label: "ユーザー", icon: "users" },
  ], active: "audit", ariaLabel: "管理メニュー" }));
  assert.match(html, /aria-label="管理メニュー"/);
  assert.match(html, /aria-current="page"/);
  const hub = render(h(AdminSectionTabs, { hub: "audit" }), "/admin/audit/settings");
  assert.match(hub, /class="sectabs-tabs" aria-label="監査メニュー"/);
  assert.match(hub, /href="\/admin\/audit\/settings" class="fn-btn fn-btn-sm fn-btn-primary" aria-current="page"/);
});
