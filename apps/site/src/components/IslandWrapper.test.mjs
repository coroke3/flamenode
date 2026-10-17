import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToString } from "react-dom/server";
import { IslandWrapper, IslandErrorBoundary } from "./IslandWrapper.ts";
import { SiteAdapterProvider } from "./SiteAdapterProvider.ts";
import { Link, Image, Button } from "@flamenode/ui";

test("T01: renders static children, Link, Image, and Button cleanly with SSR HTML", () => {
  const html = renderToString(
    React.createElement(
      IslandWrapper,
      null,
      React.createElement(
        "div",
        null,
        React.createElement("h2", null, "Static Title"),
        React.createElement(Link, { href: "/events/test-event" }, "Event Detail"),
        React.createElement(Image, { src: "/images/thumb.jpg", alt: "Thumbnail", width: 100, height: 100 }),
        React.createElement(Button, { variant: "primary" }, "Click Me")
      )
    )
  );

  assert.ok(html.includes("Static Title"), "must include static title");
  assert.ok(html.includes('href="/events/test-event"'), "Link must render standard anchor with href");
  assert.ok(html.includes('src="/images/thumb.jpg"'), "Image must render standard img with src");
  assert.ok(html.includes('alt="Thumbnail"'), "Image must include alt");
  assert.ok(html.includes("Click Me"), "Button must render label");
});

test("T02: multiple islands coexist independently via Context without modifying module globals", () => {
  const island1 = renderToString(
    React.createElement(
      IslandWrapper,
      null,
      React.createElement(Link, { href: "/page-1" }, "Link 1")
    )
  );

  const island2 = renderToString(
    React.createElement(
      IslandWrapper,
      null,
      React.createElement(Link, { href: "/page-2" }, "Link 2")
    )
  );

  assert.ok(island1.includes('href="/page-1"'));
  assert.ok(island2.includes('href="/page-2"'));
});

test("T03: error boundary catches error and renders fallback without crashing whole page", () => {
  const originalError = console.error;
  console.error = () => {};

  try {
    const fallbackNode = React.createElement("div", { className: "custom-fallback" }, "Custom Fallback");
    const boundary = new IslandErrorBoundary({ fallback: fallbackNode });
    
    // Test derived state from error
    const state = IslandErrorBoundary.getDerivedStateFromError(new Error("Test error"));
    assert.equal(state.hasError, true);
    assert.equal(state.error?.message, "Test error");

    // Test render in error state
    boundary.state = state;
    const renderedFallback = renderToString(boundary.render());
    assert.ok(renderedFallback.includes("Custom Fallback"));

    // Test default fallback
    const defaultBoundary = new IslandErrorBoundary({});
    defaultBoundary.state = state;
    const defaultFallbackHtml = renderToString(defaultBoundary.render());
    assert.ok(defaultFallbackHtml.includes("fn-island-error"));
    assert.ok(defaultFallbackHtml.includes("この領域の読み込みに失敗しました。"));
  } finally {
    console.error = originalError;
  }
});

test("T04: apps/site has zero next/* imports", () => {
  const siteDir = path.resolve(process.cwd(), "apps/site/src");

  function scanDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (/\.(ts|tsx|js|jsx|astro)$/.test(entry.name)) {
        const content = fs.readFileSync(fullPath, "utf-8");
        assert.ok(
          !content.includes('from "next') && !content.includes("from 'next"),
          `File ${fullPath} must not import from next/*`
        );
      }
    }
  }

  scanDir(siteDir);
});

test("T05: apps/site has zero calls to deprecated module-level adapter setters", () => {
  const siteDir = path.resolve(process.cwd(), "apps/site/src");

  function scanDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (/\.(ts|tsx|js|jsx|astro)$/.test(entry.name)) {
        const content = fs.readFileSync(fullPath, "utf-8");
        assert.ok(!content.includes("setLinkComponent("), `File ${fullPath} calls setLinkComponent`);
        assert.ok(!content.includes("setImageComponent("), `File ${fullPath} calls setImageComponent`);
        assert.ok(!content.includes("setNavigatorAdapter("), `File ${fullPath} calls setNavigatorAdapter`);
      }
    }
  }

  scanDir(siteDir);
});
