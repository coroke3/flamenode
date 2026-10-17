import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) =>
  fs.readFileSync(path.join(root, file), "utf8");

test("public header menus share one navigation source", async () => {
  const header = read("src/components/layout/PublicHeader.tsx");
  const account = read("src/components/layout/PublicAccountIsland.tsx");

  assert.match(header, /from ["']\.\/publicNavigation["']/);
  assert.match(account, /from ["']\.\/publicNavigation["']/);
  assert.doesNotMatch(header, /const PUBLIC_NAV_ITEMS/);
  assert.doesNotMatch(account, /const MOBILE_NAV_ITEMS/);
  // MIG-0203: the data moved to packages/ui behind a bridge, so check the values
  // the module exports instead of the text of one file.
  const { PUBLIC_NAV_ITEMS } = await import("./publicNavigation.ts");
  assert.deepEqual(
    PUBLIC_NAV_ITEMS.map((item) => item.href),
    ["/list", "/user", "/event"],
  );
});

test("tablet header keeps the account visible beside the navigation menu", () => {
  const css = read("src/components/layout/PublicHeader.module.css");
  const tablet = css.match(
    /@media \(min-width: 641px\) and \(max-width: 1180px\) \{([\s\S]*?)\n\}/,
  )?.[1] ?? "";

  assert.match(tablet, /\.searchToggle,\s*\n\s*\.headerCta/);
  assert.doesNotMatch(tablet, /\.actionNav/);
  assert.match(tablet, /display:\s*none/);
  assert.match(tablet, /\.menuToggle[\s\S]*?display:\s*inline-flex/);
});

test("desktop public navigation stays text-only and undecorated", () => {
  const header = read("src/components/layout/PublicHeader.tsx");
  const css = read("src/components/layout/PublicHeader.module.css");

  assert.doesNotMatch(header, /<Icon\s+name=\{item\.iconName\}/);
  assert.doesNotMatch(css, /\.desktopNavLink::after/);
  assert.doesNotMatch(css, /\.header::after/);
  assert.match(css, /\.header\s*\{[\s\S]*?background:\s*var\(--bg-overlay\);/);
  assert.doesNotMatch(css, /\.desktopNavLink:hover::after|\.desktopNavLinkActive::after/);
});

test("mobile active navigation uses color only and the dialog container has no focus frame", () => {
  const css = read("src/components/layout/PublicHeader.module.css");

  assert.doesNotMatch(css, /\.mobileLinkActive\s*\{[^}]*border\s*:/s);
  assert.match(css, /\.mobileNav:focus-visible\s*\{[^}]*outline:\s*0/s);
});

test("personal and console headers use the same container geometry as home", () => {
  const shellCss = read("src/styles/admin-manage.css");
  const mobileCss = read("src/styles/mobile-hardening.css");

  assert.match(
    shellCss,
    /\[data-fn-surface="admin"\] \.fn-header-inner,[\s\S]*?\[data-fn-surface="personal"\] \.fn-header-inner \{[\s\S]*?display: grid;/,
  );
  assert.match(
    shellCss,
    /@media \(min-width: 1001px\)[\s\S]*?\[data-fn-surface="personal"\] \.fn-header-inner \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) max-content minmax\(0, 1fr\)/,
  );
  assert.match(
    mobileCss,
    /\[data-fn-surface="personal"\] \.fn-header-inner,[\s\S]*?display: grid;[\s\S]*?grid-template-columns: minmax\(0, 1fr\) max-content/,
  );
});

test("mobile account loading still leaves public navigation usable", () => {
  const account = read("src/components/layout/PublicAccountIsland.tsx");
  assert.match(account, /<div className=\{styles\.mobileSection\} aria-busy="true">/);
  assert.match(
    account,
    /aria-busy="true">[\s\S]*?PUBLIC_NAV_ITEMS\.map/,
  );
});
