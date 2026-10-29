// MIG-0504 U03: capture and smoke-check the four fixture user routes at the required viewports.
// CI installs Playwright only for this isolated visual job; nothing is deployed.
import assert from "node:assert/strict";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const origin = process.env.MIG_0504_BASE_URL || "http://127.0.0.1:4329";
const destination = path.resolve(process.env.MIG_0504_SCREENSHOT_DIR || "artifacts/mig-0504-visual");
const routes = [
  { url: "/user/", name: "Creators" },
  { url: "/user/miku_producer/", name: "Creator" },
  { url: "/user/miku_producer/portfolio/", name: "Portfolio" },
  { url: "/user/long_list/", name: "CreatorLongList" },
];
const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
];

await mkdir(destination, { recursive: true });
const browser = await chromium.launch({ headless: true });
let failures = 0;
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      colorScheme: "dark",
      reducedMotion: "reduce",
    });
    try {
      for (const route of routes) {
        const page = await context.newPage();
        const pageErrors = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));
        const response = await page.goto(new URL(route.url, origin).toString(), {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        assert.equal(response?.status(), 200, route.url + " must be a built, public fixture page");
        await page.locator("main").waitFor({ state: "visible", timeout: 15000 });
        await page.waitForTimeout(800); // allow the Astro React Islands to hydrate
        const shape = await page.evaluate(() => ({
          docWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
          mainWidth: document.querySelector("main")?.getBoundingClientRect().width ?? 0,
          title: document.title,
          h1: document.querySelector("h1")?.textContent?.trim() ?? "",
        }));
        const screenshot = path.join(destination, route.name + "." + viewport.name + ".png");
        await page.screenshot({ path: screenshot, fullPage: true });
        assert.ok((await stat(screenshot)).size > 1000, "empty screenshot: " + screenshot);
        assert.ok(shape.title && shape.h1, "missing title/h1: " + route.url);
        assert.ok(shape.mainWidth > 0, "collapsed main: " + route.url);
        if (shape.docWidth > shape.viewportWidth + 2) {
          failures += 1;
          console.error("MIG-0504 U03 horizontal overflow: " + JSON.stringify({route:route.url,viewport:viewport.name,...shape}));
        }
        if (pageErrors.length) {
          failures += 1;
          console.error("MIG-0504 U03 hydration errors: " + JSON.stringify({route:route.url,viewport:viewport.name,pageErrors}));
        }
        console.log("MIG-0504 U03 captured " + path.basename(screenshot) + " " + JSON.stringify(shape));
        await page.close();
      }
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
assert.equal(failures, 0, "MIG-0504 U03 viewport/hydration smoke failures");
console.log("MIG-0504 U03: eight full-page screenshots saved in " + destination);
