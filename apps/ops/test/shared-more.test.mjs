// MIG-0707 U05c: remaining seven leaf-component SSR regressions.
import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { JSDOM } from "jsdom";
import { ConsoleShell } from "../.test-dist/apps/ops/src/components/shared/ConsoleShell.js";
import { FnTable } from "../.test-dist/apps/ops/src/components/shared/FnTable.js";
import { ConfirmDialog } from "../.test-dist/apps/ops/src/components/shared/ConfirmDialog.js";
import { AutoSubmitSelect, AutoSubmitCheckbox } from "../.test-dist/apps/ops/src/components/shared/AutoSubmitSelect.js";
import { Pagination } from "../.test-dist/apps/ops/src/components/shared/Pagination.js";
import { ManageXIcon } from "../.test-dist/apps/ops/src/components/shared/ManageXIcon.js";
import { UserAvatar } from "../.test-dist/apps/ops/src/components/shared/UserAvatar.js";

const h = (type, props, ...children) => React.createElement(type, props, ...children);
const render = (element, at = "/admin") =>
  renderToStaticMarkup(h(MemoryRouter, { initialEntries: [at] }, element));
const doc = (element, path) => new JSDOM(render(element, path)).window.document;

test("MIG-0707 T06: ConsoleShell/Drawer keep CURRENT navigation and aria names", () => {
  const admin = doc(h(ConsoleShell, { consoleMode: "admin", navigation: h("a", { href: "/admin" }, "ホーム") },
    h("main", null, "管理者")));
  assert.equal(admin.querySelector('[data-console-mode="admin"]')?.className, "admin-shell");
  assert.equal(admin.querySelector("aside")?.getAttribute("aria-label"), "管理メニュー");
  assert.equal(admin.querySelector("button[aria-haspopup='dialog']")?.getAttribute("aria-expanded"), "false");
  const manage = doc(h(ConsoleShell, { consoleMode: "manage", navigation: "イベント一覧" },
    h("main", null, "運営")), "/manage/events/event-1/slots");
  assert.equal(manage.querySelector('[data-console-mode="manage"]')?.className, "manage-shell");
  assert.match(manage.querySelector("button[aria-haspopup='dialog']")?.getAttribute("aria-label") ?? "", /event-1 \/ 枠管理/);
});
test("MIG-0707 T06: FnTable keeps CURRENT scroll accessibility", () => {
  const document = doc(h(FnTable, { className: "custom" }, h("tbody", null,
    h("tr", null, h("td", null, "値")))));
  assert.equal(document.querySelector("table")?.className, "fn-table custom");
  assert.equal(document.querySelector(".fn-sr-only")?.textContent, "横にスクロールして全体を表示できます");
  assert.equal(document.querySelector(".fn-table-scroll")?.getAttribute("class"), "fn-table-scroll fn-scroll-affordance");
});
test("MIG-0707 T06: ConfirmDialog keeps text gate, aria and tone", () => {
  assert.equal(render(h(ConfirmDialog, { open: false, title: "削除", onConfirm() {}, onCancel() {} })), "");
  const document = doc(h(ConfirmDialog, { open: true, title: "削除", message: "復元不可",
    expectedText: "DELETE", tone: "danger", onConfirm() {}, onCancel() {} }));
  assert.equal(document.querySelector('[role="alertdialog"]')?.getAttribute("aria-modal"), "true");
  assert.ok(document.querySelector('[role="alertdialog"]')?.getAttribute("aria-labelledby"));
  assert.equal(document.querySelector(".confirm-title")?.textContent, "削除");
  assert.equal(document.querySelector(".confirm-confirmationLabel code")?.textContent, "DELETE");
  assert.equal(document.querySelectorAll("button:disabled").length, 1);
  assert.equal(document.querySelector(".confirm-backdrop")?.getAttribute("role"), "presentation");
});
test("MIG-0707 T06: AutoSubmit controls keep CURRENT attributes", () => {
  const document = doc(h("form", { method: "get" },
    h(AutoSubmitSelect, { name: "sort", defaultValue: "new" },
      h("option", { value: "new" }, "新着"), h("option", { value: "old" }, "旧着")),
    h(AutoSubmitCheckbox, { name: "private", defaultChecked: true })));
  assert.equal(document.querySelector("select[name='sort']")?.value, "new");
  assert.equal(document.querySelectorAll("option").length, 2);
  assert.equal(document.querySelector('input[name="private"]')?.type, "checkbox");
  assert.equal(document.querySelector('input[name="private"]')?.checked, true);
});
test("MIG-0707 T06: Pagination keeps active/previous/next links", () => {
  assert.equal(render(h(Pagination, { currentPage: 1, totalPages: 1, total: 1, buildHref: n => "/admin/users?page=" + n })), "");
  const document = doc(h(Pagination, { currentPage: 2, totalPages: 4, total: 51, pageSize: 20,
    buildHref: n => "/admin/users?page=" + n }));
  assert.equal(document.querySelector("nav")?.getAttribute("aria-label"), "ページ送り");
  assert.ok(document.body.textContent.includes("21〜40 / 全 51 件"));
  assert.ok(document.querySelector('a[aria-label="前のページ"][href="/admin/users?page=1"]'));
  assert.ok(document.querySelector('a[aria-label="次のページ"][href="/admin/users?page=3"]'));
  assert.equal(document.querySelector('a[aria-current="page"]')?.textContent, "2");
});
test("MIG-0707 T06: ManageXIcon and UserAvatar keep CURRENT fallback and cache", () => {
  const fallback = doc(h(ManageXIcon, { iconUrl: null, label: "@alice", size: 36 }));
  assert.equal(fallback.querySelector("span.manage-staff-avatar-fallback")?.textContent, "A");
  assert.equal(fallback.querySelector("span")?.getAttribute("aria-hidden"), "true");
  const image = doc(h(UserAvatar, { iconUrl: "https://drive.google.com/file/d/abcdefghi/view", label: "test" }));
  assert.equal(image.querySelector("img")?.getAttribute("src"), "/api/google-drive-image/abcdefghi");
  assert.equal(image.querySelector("img")?.getAttribute("alt"), "");
});
