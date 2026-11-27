// MIG-0701 U04 (D-13-5): exact original CSS/font, derived modules and class coverage.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { MODULES, portCssModule } from "../scripts/portCssModule.mjs";
const root = new URL("../../../", import.meta.url);
const read = (p) => readFile(new URL(p, root), "utf8");
const names = ["globals", "redesign-public", "mobile-public", "admin-manage", "admin-mobile", "mobile-hardening"];

test("MIG-0701 U04 T07: CURRENT CSS and font are byte-identical", async () => {
  for (const n of names) assert.equal(await read("src/styles/" + n + ".css"), await read("apps/app/src/styles/current/" + n + ".css"), n);
  const [a, b] = await Promise.all([
    readFile(new URL("app/fonts/FlameNodeSans.otf", root)),
    readFile(new URL("apps/app/src/assets/FlameNodeSans.otf", root)),
  ]);
  assert.ok(a.equals(b));
});
test("MIG-0701/MIG-0712 T07: CSS modules merge deterministically without overwriting a shared target", async () => {
  const targets = new Map();
  for (const [prefix, from, to] of MODULES) {
    const chunks = targets.get(to) ?? [];
    chunks.push(portCssModule(await read(from), prefix));
    targets.set(to, chunks);
  }
  for (const [to, chunks] of targets) {
    const output = await read(to);
    assert.equal(output, chunks.join("\n"), to);
    assert.equal(output.includes(":global("), false, to);
  }
  for (const [path, expected] of [
    ["apps/app/src/styles/forms-a.css", ["ydesc", "cq", "perm-badge", "perm-lock", "perm-label"]],
    ["apps/app/src/styles/shared-social.css", ["social", "ychan", "cdlg", "sqicon"]],
  ]) {
    const prefixes = MODULES.filter((entry) => entry[2] === path).map((entry) => entry[0]);
    for (const prefix of expected) assert.ok(prefixes.includes(prefix), path + " must include " + prefix);
  }
});
test("MIG-0701 follow-up: mobile dashboard actions match the global fn-btn class", async () => {
  const [source, target, dashboard] = await Promise.all([
    read("app/(auth)/dashboard/page.module.css"),
    read("apps/app/src/styles/dashboard.css"),
    read("apps/app/src/routes/dashboard/Dashboard.tsx"),
  ]);
  // CSS modules must not hash the existing global fn-btn class.
  assert.match(source, /\.accountActions\s+:global\(\.fn-btn\)\s*\{/);
  assert.match(target, /\.dash-accountActions\s+\.fn-btn\s*\{\s*width:\s*100%/);
  assert.doesNotMatch(target, /\.dash-accountActions\s+\.dash-fn-btn\b/);
  for (const href of ["/dashboard/settings", "/entry"]) {
    assert.ok(dashboard.includes(`href="${href}" className="fn-btn `),
      `dashboard action ${href} must use the global fn-btn class`);
  }
  assert.equal(target, portCssModule(source, "dash"), "generated SPA CSS must match CURRENT");
  const [settingsCurrent, settingsSpa] = await Promise.all([
    read("src/components/settings/settings-page.module.css"),
    read("apps/app/src/styles/settings.css"),
  ]);
  assert.match(settingsCurrent, /\.addRow\s+:global\(\.fn-btn\)\s*\{/);
  assert.match(settingsSpa, /\.settings-addRow\s+\.fn-btn\s*\{\s*width:\s*100%/);
  assert.doesNotMatch(settingsSpa, /\.settings-addRow\s+\.settings-fn-btn\b/);
  assert.equal(settingsSpa, portCssModule(settingsCurrent, "settings"),
    "settings SPA CSS must match CURRENT after global-class fix");
});

test("MIG-0714 B05: global spans preserve nested selector meaning and local prefixes", () => {
  const cases = [
    [".form :global(.fn-input:not(:disabled):not([readonly])):hover", ".vform-form .fn-input:not(:disabled):not([readonly]):hover"],
    [".form :global(:is(.fn-input:not(:disabled), .fn-select))", ".vform-form :is(.fn-input:not(:disabled), .fn-select)"],
    [".form :global(.fn-btn) :global(svg)", ".vform-form .fn-btn svg"],
    [".form:global(.fn-input:not(:disabled)).active", ".vform-form.fn-input:not(:disabled).vform-active"],
    ['.form :global(.fn-input[data-help=")"]:not(:disabled))', '.vform-form .fn-input[data-help=")"]:not(:disabled)'],
    [String.raw`.form :global(.fn-input[data-help=')']:not(:disabled))`, String.raw`.vform-form .fn-input[data-help=')']:not(:disabled)`],
    [String.raw`.form :global(.icon-\):not(:disabled))`, String.raw`.vform-form .icon-\):not(:disabled)`],
    [".form :global(.fn-input/* ) */:not(:disabled)):hover", ".vform-form .fn-input/* ) */:not(:disabled):hover"],
    [".form :global(.fn-input/* ( */:not([readonly])).active", ".vform-form .fn-input/* ( */:not([readonly]).vform-active"],
    [String.raw`.form :global([data-open="/*)"][data-close='*/('] .fn-input):hover`, String.raw`.vform-form [data-open="/*)"][data-close='*/('] .fn-input:hover`],
  ];
  for (const [source, expected] of cases) {
    const rule = source + " { color: red; }";
    assert.equal(portCssModule(rule, "vform"), expected + " { color: red; }", source);
  }
  const dom = new JSDOM('<form class="vform-form"></form><input class="fn-input">');
  try {
    const form = dom.window.document.querySelector("form");
    for (const [tag, source, expected] of [
      ["input", cases[0][0], [true, false, false, false]],
      // CURRENT intentionally permits readonly textarea hover; do not generalize input policy.
      ["textarea", ".form :global(.fn-textarea:not(:disabled)):hover", [true, true, false, false]],
    ]) {
      const selector = portCssModule(source + " { color: red; }", "vform").split(" {")[0].replace(/:hover$/, "");
      for (const [index, [readonly, disabled]] of [[false, false], [true, false], [false, true], [true, true]].entries()) {
        const control = dom.window.document.createElement(tag);
        control.className = "fn-" + tag;
        control.readOnly = readonly;
        control.disabled = disabled;
        form.replaceChildren(control);
        assert.equal(control.matches(selector), expected[index], `${tag} readonly=${readonly} disabled=${disabled}`);
      }
      assert.equal(dom.window.document.querySelector("body > input").matches(selector), false, "scoped to form");
    }
  } finally { dom.window.close(); }
});

async function getTsx(dir) {
  const entries = await readdir(new URL(dir, root), { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const p = dir + entry.name;
    if (entry.isDirectory()) out.push(...await getTsx(p + "/"));
    else if (entry.isFile() && p.endsWith(".tsx")) out.push(p);
  }
  return out;
}
test("MIG-0701 U04 T08: every Personal route class has a CSS definition", async () => {
  const css = (await Promise.all([
    ...names.map((n) => read("apps/app/src/styles/current/" + n + ".css")),
    ...MODULES.map(([, , to]) => read(to)),
    read("apps/app/src/styles/xid-requests.css"),
  ])).join("\n");
  const defined = new Set([...css.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((m) => m[1]));
  const exceptions = new Set([
    "fn-pc-status-banner--warn",
    "settings-panel-x", "settings-panel-history", "settings-panel-link", "settings-panel-discord",
    "settings-x-h", "settings-history-h", "settings-link-h", "settings-discord-h",
  ]);
  const missing = new Set();
  for (const p of await getTsx("apps/app/src/routes/")) {
    const source = (await read(p)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const [, token] of source.matchAll(/(?<![\w-])((?:fn|dash|onb|settings|vcard)-[A-Za-z0-9_-]*[A-Za-z0-9_])/g)) {
      if (!defined.has(token) && !exceptions.has(token)) missing.add(p + ": " + token);
    }
  }
  assert.deepEqual([...missing].sort(), [], "missing Personal CSS definitions");
});
test("MIG-0714 B05: every full-form vform class has a derived CSS definition", async () => {
  const css = await read("apps/app/src/styles/video-form.css");
  const defined = new Set([...css.matchAll(/\.(vform-[A-Za-z_][\w-]*)/g)].map((m) => m[1]));
  const used = new Set(), missing = [];
  for (const file of await getTsx("apps/app/src/components/forms/")) {
    for (const [name] of (await read(file)).matchAll(/\bvform-[A-Za-z_][\w-]*/g)) {
      used.add(name);
      if (!defined.has(name)) missing.push(file + ": " + name);
    }
  }
  assert.ok(used.size > 0, "full form must reference the generated vform styles");
  assert.deepEqual(missing, [], "missing full-form CSS definitions");
});
test("MIG-0701 U04 T07: main imports CSS in CURRENT order", async () => {
  const actual = [...(await read("apps/app/src/main.tsx")).matchAll(/^import "(.+\.css)";$/gm)].map((m) => m[1]);
  assert.deepEqual(actual, [
    "./styles/current/globals.css", "./styles/current/mobile-hardening.css",
    "./styles/fonts.css", "./styles/video-card.css", "./styles/dashboard.css",
    "./styles/settings.css", "./styles/xid-settings.css", "./styles/onboarding.css", "./styles/entry.css", "./styles/xid-requests.css", "./styles/video-members.css", "./styles/forms-a.css", "./styles/shared-social.css",
    "./styles/cost-guard-banner.css",
    "./styles/video-form.css",
    "./styles/video-edit-permission-overview.css",
  ]);
});
