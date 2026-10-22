// MIG-0504: CreatorsView (/user) and PortfolioView (/user/[id]/portfolio) rendered to HTML and queried in jsdom.
// Entry points and texts follow CURRENT user/UserIndexView.tsx and user/[id]/portfolio/page.tsx.
import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { CreatorsView, PortfolioView } from "../dist/index.js";

const render = (C, props) => new JSDOM(renderToStaticMarkup(React.createElement(C, props))).window.document;
const hrefs = (doc) => [...doc.querySelectorAll("a")].map((a) => a.getAttribute("href"));
const text = (el) => (el.body ?? el).textContent.replace(/\s+/g, " ").trim();

const creators = [
  { id: "otako", name: "おたこ", iconUrl: "https://img.example/a.jpg", ownCount: 7, collabCount: 3, totalCount: 10 },
  { id: "noicon", name: "アイコンなし", iconUrl: null, ownCount: 0, collabCount: 0, totalCount: 0 },
];
const base = { creators, total: 100, currentPage: 2, totalPages: 3, pageSize: 48, query: "", sort: "score", buildHref: (p) => `/user?page=${p}` };

test("creators: heading, count, search form contract, cards with handle / totals / own+collab, pager", () => {
  const doc = render(CreatorsView, base);
  assert.equal(text(doc.querySelector("h1")), "クリエイターを見つける");
  assert.ok(text(doc).includes("100 件"));
  const form = doc.querySelector("form");
  assert.equal(form.getAttribute("method"), "get");
  assert.equal(form.querySelector('input[name="q"]').getAttribute("placeholder"), "名前 / X ID");
  assert.equal(form.querySelector('input[name="q"]').getAttribute("aria-label"), "クリエイター検索");
  assert.equal(form.querySelector("select[name=sort]").getAttribute("aria-label"), "並び替え");
  assert.equal(form.querySelector("a"), null, "no リセット on the default view");
  const links = hrefs(doc);
  assert.ok(links.includes("/user/otako") && links.includes("/user/noicon"));
  assert.ok(links.includes("/user?page=1") && links.includes("/user?page=3"));
  const card = text(doc.querySelector(".cr-icons a"));
  assert.ok(card.includes("おたこ") && card.includes("@otako") && card.includes("10 作品") && card.includes("主催 7 / 参加 3"));
  assert.equal(doc.querySelectorAll(".cr-icons img").length, 1, "the creator without an icon gets the neutral placeholder");
});

test("creators: reset link with a query, empty and unavailable notices, no mock-only view switcher", () => {
  const withQuery = render(CreatorsView, { ...base, query: "ota", sort: "works" });
  assert.equal(withQuery.querySelector("form a").getAttribute("href"), "/user");
  assert.equal(withQuery.querySelector('input[name="q"]').getAttribute("value"), "ota");
  assert.equal(withQuery.querySelector("select option[selected]")?.getAttribute("value") ?? withQuery.querySelector("select").value, "works");
  const empty = render(CreatorsView, { ...base, creators: [], total: 0, totalPages: 1 });
  assert.ok(text(empty).includes("条件に合うクリエイターが見つかりませんでした。"));
  assert.equal(text(empty).includes("0 件"), false);
  const unavailable = render(CreatorsView, { ...base, creators: [], total: 0, totalPages: 1, unavailable: true });
  assert.ok(text(unavailable).includes("公開クリエイター一覧を一時的に表示できません。"));
  assert.equal(empty.querySelectorAll("button").length, 0, "no do-nothing buttons");
});

const portfolio = {
  id: "otako", name: "おたこ", iconUrl: "https://img.example/a.jpg", youtubeChannelUrl: "https://www.youtube.com/@o",
  socialLinks: [{ label: "example.com", url: "https://example.com/" }, { label: "me@example.com", url: "mailto:me@example.com" }],
  profileText: "アニメと実写を混ぜた短編を作っています。", contact: "DMへ",
  works: [{ href: "/yt1", title: "作品1" }, { href: "/yt2", title: "作品2" }], totalWorks: 40, workLimit: 36,
};

test("portfolio: CURRENT links (profile, list, すべて見る, X, YouTube, social) and About / Contact / Works", () => {
  const doc = render(PortfolioView, { portfolio });
  assert.equal(text(doc.querySelector("h1")), "おたこ");
  const links = hrefs(doc);
  for (const href of ["/user/otako", "/user", "https://x.com/otako", "https://www.youtube.com/@o", "https://example.com/", "mailto:me@example.com", "/yt1", "/yt2"]) {
    assert.ok(links.includes(href), `missing ${href}`);
  }
  const t = text(doc);
  for (const s of ["@otako の公開プロフィール", "Portfolio", "Works", "About", "Contact", "すべて見る", "アニメと実写を混ぜた短編を作っています。", "DMへ"]) assert.ok(t.includes(s), s);
  assert.equal(doc.querySelector(".metric b").textContent, "40");
  assert.equal(doc.querySelector('a[aria-label="一覧へ戻る"]').getAttribute("href"), "/user");
  assert.equal(doc.querySelector('a[href="mailto:me@example.com"]').getAttribute("target"), null);
  assert.equal(doc.querySelector('a[href="https://example.com/"]').getAttribute("rel"), "noopener noreferrer");
});

test("portfolio: empty states and no すべて見る at or under the limit", () => {
  const doc = render(PortfolioView, { portfolio: { ...portfolio, works: [], totalWorks: 36, profileText: null, contact: null, socialLinks: [], youtubeChannelUrl: null } });
  const t = text(doc);
  assert.ok(t.includes("このポートフォリオには、まだプロフィール項目が登録されていません。"));
  assert.ok(t.includes("まだ公開されている作品がありません。"));
  assert.equal(t.includes("すべて見る"), false);
  assert.equal(doc.querySelector(".metric b").textContent, "36");
});
