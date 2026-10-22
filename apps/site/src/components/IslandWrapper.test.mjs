// MIG-0402 Work Order test cases, run in a real DOM (jsdom) with react-dom/client.
// Run with `npm run test --workspace=@flamenode/site` (builds the site first for T01).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import("react")).default;
const { createRoot, hydrateRoot } = await import("react-dom/client");
const { renderToString } = await import("react-dom/server");
const { AdapterProvider, Link, LinkContext, ImageContext, NavigatorContext } = await import("@flamenode/ui");
const { IslandWrapper, ISLAND_ERROR_MESSAGE } = await import("./IslandWrapper.ts");
const { ButtonIsland } = await import("./ButtonIsland.ts");
const { SiteLink, SiteImage, siteNavigator } = await import("./SiteAdapterProvider.ts");
const { act } = React;
const h = React.createElement;

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const srcDir = path.join(siteRoot, "src");

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|js|jsx|mjs|astro)$/.test(e.name) && !e.name.endsWith(".test.mjs") ? [full] : [];
  });
}

function mount(html = "") {
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.append(container);
  return container;
}

test("U02: the server HTML of ButtonIsland hydrates without mismatch and keeps the same nodes", async () => {
  document.body.innerHTML = "";
  const props = { label: "即時ロード (client:load)", variant: "primary" };
  const container = mount(renderToString(h(ButtonIsland, props)));
  const before = container.innerHTML;
  const button = container.querySelector("button");
  assert.ok(button, "server HTML has the button");
  const errors = [];
  let root;
  await act(async () => {
    root = hydrateRoot(container, h(ButtonIsland, props), {
      onRecoverableError: (e) => errors.push(e),
      onCaughtError: (e) => errors.push(e),
      onUncaughtError: (e) => errors.push(e),
    });
  });
  assert.deepEqual(errors, []);
  assert.equal(container.innerHTML, before, "DOM after hydration equals the server HTML");
  assert.equal(container.querySelector("button"), button, "hydration reuses the server node");
  assert.equal(button.getAttribute("type"), "button");
  assert.equal(button.textContent, props.label);
  await act(async () => root.unmount());
});

test("U01: an Island reads Link/Image/Navigator from Context (SiteAdapterProvider), not module globals", async () => {
  document.body.innerHTML = "";
  const seen = {};
  function Probe() {
    seen.link = React.useContext(LinkContext);
    seen.image = React.useContext(ImageContext);
    seen.navigator = React.useContext(NavigatorContext);
    return null;
  }
  const root = createRoot(mount());
  await act(async () => root.render(h(IslandWrapper, null, h(Probe))));
  assert.equal(seen.link, SiteLink);
  assert.equal(seen.image, SiteImage);
  assert.equal(seen.navigator, siteNavigator);
  await act(async () => root.unmount());
});

test("T02: two Islands on one page keep their own adapters", async () => {
  document.body.innerHTML = "";
  const Marked = (props) => h("a", { ...props, "data-island": "a" });
  const a = mount();
  const b = mount();
  const rootA = createRoot(a);
  const rootB = createRoot(b);
  await act(async () => {
    rootA.render(h(IslandWrapper, null, h(AdapterProvider, { link: Marked }, h(Link, { href: "/a" }, "A"))));
    rootB.render(h(IslandWrapper, null, h(Link, { href: "/b" }, "B")));
  });
  assert.equal(a.querySelector("a").getAttribute("data-island"), "a");
  assert.equal(b.querySelector("a").getAttribute("href"), "/b");
  assert.equal(b.querySelector("a").hasAttribute("data-island"), false, "island B does not see island A's Link");
  // Outside any Island no adapter leaks in through a module global.
  const outside = mount(renderToString(h(Link, { href: "/c" }, "C")));
  assert.equal(outside.querySelector("a").hasAttribute("data-island"), false);
  await act(async () => {
    rootA.unmount();
    rootB.unmount();
  });
});

test("T03: an error inside one Island shows the error callout; static HTML and the other Island stay", async () => {
  document.body.innerHTML = "";
  const staticText = document.createElement("p");
  staticText.textContent = "静的本文";
  document.body.append(staticText);
  const broken = mount();
  const healthy = mount();
  function Thrower() {
    throw new Error("island failure");
  }
  const caught = [];
  const originalError = console.error;
  console.error = () => {};
  try {
    const r1 = createRoot(broken, { onCaughtError: (e) => caught.push(e) });
    const r2 = createRoot(healthy);
    await act(async () => {
      r1.render(h(IslandWrapper, null, h(Thrower)));
      r2.render(h(ButtonIsland, { label: "ok" }));
    });
    assert.equal(caught.length, 1, "the boundary caught the error");
    const alert = broken.querySelector('[role="alert"]');
    assert.ok(alert, "fallback has role=alert");
    assert.match(alert.textContent, new RegExp(ISLAND_ERROR_MESSAGE));
    assert.ok(alert.classList.contains("fn-island-error"));
    assert.equal(alert.getAttribute("style"), null, "fallback has no inline colours");
    assert.ok(document.body.contains(staticText), "static HTML stays");
    assert.equal(healthy.querySelector("button").textContent, "ok", "the other Island still renders");
    await act(async () => {
      r1.unmount();
      r2.unmount();
    });
  } finally {
    console.error = originalError;
  }
});

test("T01: built islands PoC page has static text and link outside the Islands and the Islands' server HTML", () => {
  const file = path.join(siteRoot, "dist/migration-fixture-poc/islands/index.html");
  assert.ok(fs.existsSync(file), "run `npm run build --workspace=@flamenode/site` first");
  const doc = new JSDOM(fs.readFileSync(file, "utf8")).window.document;
  const islands = [...doc.querySelectorAll("astro-island")];
  assert.equal(islands.length, 2);
  assert.deepEqual(islands.map((el) => el.getAttribute("client")).sort(), ["load", "visible"]);
  for (const island of islands) {
    const button = island.querySelector("button.fn-btn");
    assert.ok(button, "Island has the Button server HTML (readable before hydration)");
    assert.equal(island.querySelector("astro-slot"), null, "the Button is inside the hydrated tree, not a static slot");
  }
  const h1 = doc.querySelector("h1");
  assert.equal(h1.textContent, "FlameNode Public SSG");
  assert.equal(h1.closest("astro-island"), null);
  const about = doc.querySelector('a[href="/about"]');
  assert.ok(about && about.closest("astro-island") === null, "static link outside the Islands");
});

test("T04: apps/site imports no next/*", () => {
  for (const file of sourceFiles(srcDir)) {
    const text = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(text, /from\s+["']next(\/|["'])/, file);
    assert.doesNotMatch(text, /import\(\s*["']next(\/|["'])/, file);
  }
});

test("U01: apps/site never calls the deprecated adapter setters", () => {
  for (const file of sourceFiles(srcDir)) {
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), /setLinkComponent|setImageComponent|setNavigatorAdapter/, file);
  }
});

test("U02: .astro files pass no children to IslandWrapper (Astro would render them as a static slot)", () => {
  for (const file of sourceFiles(srcDir).filter((f) => f.endsWith(".astro"))) {
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), /<IslandWrapper\b/, file);
  }
});
