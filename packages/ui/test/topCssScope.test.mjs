// The top screen's rules (MIG-0506) live in the shared screens.css that every public page loads, so each selector
// in that block must be prefixed `.tp-` and cannot restyle a generic class used by another page.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const css = fs.readFileSync(new URL("../src/styles/screens.css", import.meta.url), "utf8");
const start = css.indexOf("/* top (MIG-0506)");
const tlsStart = css.indexOf("/* top shelf Island (MIG-0507 U09)");
const end = css.indexOf("/* list / recommend / trending (MIG-0505)");
const layout = fs.readFileSync(new URL("../src/styles/layout.css", import.meta.url), "utf8");

function selectors(src, out = []) {
  let i = 0;
  while (i < src.length) {
    if (/\s/.test(src[i])) { i++; continue; }
    const open = src.indexOf("{", i);
    if (open < 0) break;
    const head = src.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (depth) { if (src[j] === "{") depth++; else if (src[j] === "}") depth--; j++; }
    if (head.startsWith("@media")) selectors(src.slice(open + 1, j - 1), out);
    else for (const s of head.split(",")) out.push(s.trim());
    i = j;
  }
  return out;
}

test("every selector of the top block in screens.css starts with .tp- (or .tls for the MIG-0507 shelf Island)", () => {
  assert.ok(start >= 0 && end > start, "top block markers");
  assert.ok(tlsStart > start && tlsStart < end, "top shelf Island block marker");
  const block = css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "");
  const all = selectors(block);
  assert.ok(all.length > 20, `parsed ${all.length} selectors`);
  assert.deepEqual(all.filter((s) => !/^\.(tp-[\w-]+|tls(-[\w-]+)?)(?![\w-])/.test(s)), []);
});

test("TopView uses the prefixed shelf classes only", () => {
  const src = fs.readFileSync(new URL("../src/screens/TopView.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /className="shelf/);
  assert.match(src, /className="tp-shelf"/);
});

test("the account menu Island block (MIG-0507) in layout.css is prefixed .hd- or scoped under the header root .hd2", () => {
  const from = layout.indexOf("/* Account menu Island (MIG-0507 U08)");
  const to = layout.indexOf(".pub-foot{", from);
  assert.ok(from >= 0 && to > from, "account block markers");
  const all = selectors(layout.slice(from, to).replace(/\/\*[\s\S]*?\*\//g, ""));
  assert.ok(all.length > 20, `parsed ${all.length} selectors`);
  assert.deepEqual(all.filter((s) => !/^(\.hd-[\w-]|\.hd2 \.)/.test(s)), []);
});
