// events.css (MIG-0502) is loaded by both public layouts, so it must not restyle generic classes other pages use
// (.seg, .select, .field-i, .sel-i, .notice ...). Every selector is event-prefixed or under the zero-specificity
// event root `:where(.ev-scope)`, which the four event screens render on their <main>.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const css = fs.readFileSync(new URL("../src/styles/events.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function selectors(src, out = []) {
  let i = 0;
  while (i < src.length) {
    if (/\s/.test(src[i])) { i++; continue; }
    const open = src.indexOf("{", i);
    if (open < 0) break;
    const head = src.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (depth) { if (src[j] === "{") depth++; else if (src[j] === "}") depth--; j++; }
    if (head.startsWith("@")) {
      if (/^@(media|container)/.test(head)) selectors(src.slice(open + 1, j - 1), out);
      else assert.match(head, /^@keyframes fn-tick$/, `unexpected at-rule ${head}`);
    } else {
      for (const s of head.split(",")) out.push(s.trim());
    }
    i = j;
  }
  return out;
}

test("every top-level selector in events.css is an event class or under :where(.ev-scope)", () => {
  const all = selectors(css);
  assert.ok(all.length > 150, `parsed ${all.length} selectors`);
  const bad = all.filter((s) => !(/^\.ev-(?!scope)[\w-]/.test(s) || s.startsWith(":where(.ev-scope) ")));
  assert.deepEqual(bad, []);
});

test("the event screens render the .ev-scope root", () => {
  for (const file of ["EventsIndexView", "EventSlotsView", "EventReleaseView", "EventDetailView"]) {
    const src = fs.readFileSync(new URL(`../src/screens/${file}.tsx`, import.meta.url), "utf8");
    assert.match(src, /ev-scope/, file);
  }
});
