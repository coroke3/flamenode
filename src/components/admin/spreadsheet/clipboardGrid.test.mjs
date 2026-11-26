import test from "node:test";
import assert from "node:assert/strict";
import { parseHtmlClipboardTable } from "../../../lib/utils/clipboardHtml.ts";
import {
  parseClipboardContent,
  looksLikeTabularClipboard,
} from "../../../lib/utils/clipboardParse.ts";

test("parseHtmlClipboardTable reads Excel-style table", () => {
  const html = `<table><tr><td>a</td><td>b</td></tr><tr><td>1</td><td>2</td></tr></table>`;
  const grid = parseHtmlClipboardTable(html);
  assert.deepEqual(grid, [
    ["a", "b"],
    ["1", "2"],
  ]);
});

test("parseClipboardContent prefers TSV from Excel plain text", () => {
  const plain = "col1\tcol2\nv1\tv2";
  const grid = parseClipboardContent(plain, "");
  assert.deepEqual(grid, [
    ["col1", "col2"],
    ["v1", "v2"],
  ]);
});

test("parseClipboardContent falls back to HTML when plain is empty", () => {
  const html = `<table><tr><td>x</td><td>y</td></tr></table>`;
  const grid = parseClipboardContent("", html);
  assert.deepEqual(grid, [["x", "y"]]);
});

test("looksLikeTabularClipboard detects multi-cell HTML", () => {
  const html = `<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>`;
  assert.equal(looksLikeTabularClipboard("", html), true);
});

test("HTML clipboard fallback preserves astral Unicode in decimal and hex references", () => {
  const html = "<table><tr><td>&#128640;</td><td>&#x1F680;</td><td>&#X1f680;</td></tr></table>";
  assert.deepEqual(parseHtmlClipboardTable(html), [["🚀", "🚀", "🚀"]]);
  assert.deepEqual(parseClipboardContent("", html), [["🚀", "🚀", "🚀"]]);
});

test("HTML clipboard fallback replaces invalid Unicode scalar references", () => {
  const html = "<table><tr><td>&#0;</td><td>&#55296;</td><td>&#x110000;</td><td>&#99999999999999999999999;</td></tr></table>";
  assert.deepEqual(parseHtmlClipboardTable(html), [["�", "�", "�", "�"]]);
});

test("HTML clipboard fallback retains valid BMP references and named entities", () => {
  const html = '<table><tr><td>&#12354;</td><td>&#x3042;</td><td>&lt;test&gt; &amp; &quot;ok&quot;</td></tr></table>';
  assert.deepEqual(parseHtmlClipboardTable(html), [["あ", "あ", '<test> & "ok"']]);
});

test("HTML clipboard fallback does not double-decode escaped entities", () => {
  const html = '<table><tr><td>&amp;#128640;</td><td>&amp;#x1F680;</td><td>&amp;lt;</td><td>&amp;amp;</td><td>&#128640;</td></tr></table>';
  assert.deepEqual(parseHtmlClipboardTable(html), [
    ["&#128640;", "&#x1F680;", "&lt;", "&amp;", "🚀"],
  ]);
  assert.deepEqual(parseClipboardContent("", html), [
    ["&#128640;", "&#x1F680;", "&lt;", "&amp;", "🚀"],
  ]);
});

test("HTML clipboard fallback preserves HTML cell line breaks, including attributed br tags", () => {
  const html = '<table><tr><td>first<br>second</td><td>A<br class="line-break" />B</td></tr></table>';
  assert.deepEqual(parseHtmlClipboardTable(html), [["first\nsecond", "A\nB"]]);
  assert.deepEqual(parseClipboardContent("", html), [["first\nsecond", "A\nB"]]);
});

test("HTML clipboard DOMParser path preserves br text separators inside nested formatting", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "DOMParser");
  const text = (nodeValue) => ({ nodeType: 3, nodeValue });
  const element = (tagName, childNodes) => ({ nodeType: 1, tagName, childNodes });
  const cell = element("TD", [
    text("first"),
    element("BR", []),
    element("STRONG", [text("second\u00a0line")]),
  ]);
  try {
    Object.defineProperty(globalThis, "DOMParser", {
      configurable: true,
      value: class DOMParserStub {
        parseFromString() {
          return {
            querySelector: (selector) => selector === "table" ? {
              querySelector: () => null,
              querySelectorAll: (name) => name === "tr" ? [{
                querySelectorAll: (cells) => cells === "td, th" ? [cell] : [],
              }] : [],
            } : null,
          };
        }
      },
    });
    assert.deepEqual(
      parseHtmlClipboardTable("<table><tr><td>first<br><strong>second&nbsp;line</strong></td></tr></table>"),
      [["first\nsecond line"]],
    );
  } finally {
    if (previous) Object.defineProperty(globalThis, "DOMParser", previous);
    else delete globalThis.DOMParser;
  }
});

test("HTML clipboard fallback declines nested tables and preserves plain TSV fallback", () => {
  const nested = "<table><tr><td>A<table><tr><td>B</td></tr></table></td><td>C</td></tr></table>";
  assert.deepEqual(parseHtmlClipboardTable(nested), []);
  assert.deepEqual(parseClipboardContent("", nested), []);
  assert.deepEqual(parseClipboardContent("A\tC", nested), [["A", "C"]]);
});

test("HTML clipboard DOMParser path declines nested tables without reading descendant rows", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "DOMParser");
  const html = "<table><tr><td>A<table><tr><td>B</td></tr></table></td><td>C</td></tr></table>";
  let reads = 0;
  try {
    Object.defineProperty(globalThis, "DOMParser", {
      configurable: true,
      value: class DOMParserStub {
        parseFromString() {
          return {
            querySelector: () => ({
              querySelector: (selector) => selector === "table" ? {} : null,
              querySelectorAll: () => { reads++; return []; },
            }),
          };
        }
      },
    });
    assert.deepEqual(parseHtmlClipboardTable(html), []);
    assert.equal(reads, 0);
    assert.deepEqual(parseClipboardContent("A\tC", html), [["A", "C"]]);
  } finally {
    if (previous) Object.defineProperty(globalThis, "DOMParser", previous);
    else delete globalThis.DOMParser;
  }
});

test("HTML clipboard fallback does not mistake comments or table attributes for nested table tags", () => {
  assert.deepEqual(
    parseHtmlClipboardTable('<table title="<table>"><!-- <table> --><tr><td>A</td><td>B</td></tr></table>'),
    [["A", "B"]],
  );
});

test("HTML clipboard fallback treats only actual br tags as breaks and handles quoted delimiters", () => {
  const html = '<table><tr><td>A<br-widget></br-widget>B</td><td>A<br title="x>y">B</td><td>A<BR class="line-break" />B</td></tr></table>';
  const expected = [["AB", "A\nB", "A\nB"]];
  assert.deepEqual(parseHtmlClipboardTable(html), expected);
  assert.deepEqual(parseClipboardContent("", html), expected);
});

test("HTML clipboard fallback strips whole quoted inline tags and comments without inventing breaks", () => {
  const html = "<table><tr><td>A<strong title='x>y'>B</strong>C</td><td>A<span title='<br>'>B</span></td><td>A<!-- <br> -->B</td></tr></table>";
  const expected = [["ABC", "AB", "AB"]];
  assert.deepEqual(parseHtmlClipboardTable(html), expected);
  assert.deepEqual(parseClipboardContent("", html), expected);
});

test("HTML clipboard fallback preserves explicit br separators at both cell edges", () => {
  const html = '<table><tr><td><br>A</td><td>A<br></td><td><br><br></td><td>B</td></tr></table>';
  const expected = [["\nA", "A\n", "\n\n", "B"]];
  assert.deepEqual(parseHtmlClipboardTable(html), expected);
  assert.deepEqual(parseClipboardContent("", html), expected);
});

test("HTML clipboard fallback retains legacy whitespace trimming and single blank row filtering", () => {
  const html = '<table><tr><td><br><br></td></tr><tr><td>  A&nbsp;  </td><td>  <br>B</td><td>C<br>  </td></tr></table>';
  const expected = [["A", "\nB", "C\n"]];
  assert.deepEqual(parseHtmlClipboardTable(html), expected);
  assert.deepEqual(parseClipboardContent("", html), expected);
  assert.deepEqual(parseHtmlClipboardTable("<table><tr><td><br></td></tr></table>"), []);
});

test("HTML clipboard fallback ignores fake table structure in comments and quoted attributes", () => {
  const fixtures = [
    '<table><!-- <tr><td>FAKE</td></tr> --><tr><td>A</td><td>B</td></tr></table>',
    '<table title="<tr><td>FAKE</td></tr>"><tr><td>A</td><td>B</td></tr></table>',
  ];
  for (const html of fixtures) {
    assert.deepEqual(parseHtmlClipboardTable(html), [["A", "B"]]);
    assert.deepEqual(parseClipboardContent("", html), [["A", "B"]]);
    assert.deepEqual(parseClipboardContent("A\tB", html), [["A", "B"]]);
  }
});

test("HTML clipboard fallback uses actual cell boundaries despite quoted delimiters and comments", () => {
  const fixtures = [
    ["<table><tr><td title='x>y'>A</td><td>B</td></tr></table>", [["A", "B"]]],
    ['<table><tr><td>A<span title="</td><td>FAKE">B</span>C</td><td>D</td></tr></table>', [["ABC", "D"]]],
    '<table><tr><td>A<!-- </td><td>FAKE -->B</td><td>C</td></tr></table>',
  ];
  assert.deepEqual(parseHtmlClipboardTable(fixtures[0][0]), fixtures[0][1]);
  assert.deepEqual(parseClipboardContent("", fixtures[0][0]), fixtures[0][1]);
  assert.deepEqual(parseHtmlClipboardTable(fixtures[1][0]), fixtures[1][1]);
  assert.deepEqual(parseClipboardContent("", fixtures[1][0]), fixtures[1][1]);
  assert.deepEqual(parseHtmlClipboardTable(fixtures[2]), [["AB", "C"]]);
  assert.deepEqual(parseClipboardContent("", fixtures[2]), [["AB", "C"]]);
});

test("HTML clipboard fallback refuses unbalanced cells rather than pasting partial HTML data", () => {
  const html = '<table><tr><td>A</td><td>B</th></tr></table>';
  assert.deepEqual(parseHtmlClipboardTable(html), []);
  assert.deepEqual(parseClipboardContent("", html), []);
  assert.deepEqual(parseClipboardContent("A\tB", html), [["A", "B"]]);
});

test("HTML clipboard fallback declines inert and unsupported raw-text table contexts", () => {
  const ghost = '<table><tr><td>GHOST</td><td>ROW</td></tr></table>';
  const fixtures = [
    `<!-- ${ghost} -->`,
    `<template>${ghost}</template>`,
    `<script>const html = '${ghost}';</script>`,
    `<textarea>${ghost}</textarea>`,
    `<style>${ghost}</style>`,
    `<title>${ghost}</title>`,
    `<plaintext>${ghost}`,
    `<table><tr><td> </td></tr><!-- <tr><td>GHOST</td><td>ROW</td></tr> --></table>`,
  ];
  for (const html of fixtures) {
    assert.deepEqual(parseHtmlClipboardTable(html), []);
    assert.deepEqual(parseClipboardContent("KEEP", html), [["KEEP"]]);
    assert.equal(looksLikeTabularClipboard("KEEP", html), false);
  }
  const normal = '<html><head><title>Sheet</title><style>td { color: red; }</style></head><body><table title="<template>"><tr><td>A</td><td>B</td></tr></table></body></html>';
  assert.deepEqual(parseHtmlClipboardTable(normal), [["A", "B"]]);
  assert.deepEqual(parseHtmlClipboardTable(normal.replace("td { color: red; }", "<!-- td { color: red; } -->")), [["A", "B"]]);
});

test("HTML clipboard DOMParser empty results are authoritative, not a trigger for regex fallback", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "DOMParser");
  const ghost = '<table><tr><td>GHOST</td><td>ROW</td></tr></table>';
  const fixtures = [
    ['<tr><td>GHOST</td><td>ROW</td></tr>', null],
    ['<table><tr><td> </td></tr></table>' + ghost, {
      querySelector: () => null,
      querySelectorAll: () => [{ querySelectorAll: () => [{ childNodes: [{ nodeType: 3, nodeValue: " " }] }] }],
    }],
  ];
  try {
    for (const [html, table] of fixtures) {
      Object.defineProperty(globalThis, "DOMParser", {
        configurable: true,
        value: class DOMParserStub {
          parseFromString() { return { querySelector: () => table }; }
        },
      });
      assert.deepEqual(parseHtmlClipboardTable(html), []);
      assert.deepEqual(parseClipboardContent("KEEP", html), [["KEEP"]]);
      assert.equal(looksLikeTabularClipboard("KEEP", html), false);
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, "DOMParser", previous);
    else delete globalThis.DOMParser;
  }
});

test("HTML clipboard DOMParser exception retains the bounded fallback", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "DOMParser");
  try {
    Object.defineProperty(globalThis, "DOMParser", {
      configurable: true,
      value: class DOMParserStub {
        parseFromString() { throw new Error("parser unavailable"); }
      },
    });
    const html = '<table><tr><td>A<br>B</td><td>C</td></tr></table>';
    assert.deepEqual(parseHtmlClipboardTable(html), [["A\nB", "C"]]);
    assert.deepEqual(parseClipboardContent("KEEP", `<template>${html}</template>`), [["KEEP"]]);
  } finally {
    if (previous) Object.defineProperty(globalThis, "DOMParser", previous);
    else delete globalThis.DOMParser;
  }
});

test("HTML clipboard fallback uses only the first explicit table", () => {
  const first = '<table><tr><td>A</td></tr></table>';
  const ghost = '<tr><td>GHOST</td><td>ROW</td></tr>';
  for (const html of [first + '<table>' + ghost + '</table>', ghost + first, first + ghost]) {
    assert.deepEqual(parseHtmlClipboardTable(html), [["A"]]);
    assert.deepEqual(parseClipboardContent("A", html), [["A"]]);
    assert.equal(looksLikeTabularClipboard("A", html), false);
  }
  const blank = '<table><tr><td> </td></tr></table>' + '<table>' + ghost + '</table>';
  assert.deepEqual(parseHtmlClipboardTable(blank), []);
  assert.deepEqual(parseClipboardContent("KEEP", blank), [["KEEP"]]);
  assert.equal(looksLikeTabularClipboard("KEEP", blank), false);
});

test("HTML clipboard fallback preserves supported standalone row fragments and first-table cell breaks", () => {
  const fragment = '<tr><td>A<br>B</td><td>C</td></tr>';
  assert.deepEqual(parseHtmlClipboardTable(fragment), [["A\nB", "C"]]);
  assert.deepEqual(parseClipboardContent("", fragment), [["A\nB", "C"]]);
  assert.equal(looksLikeTabularClipboard("", fragment), true);
  const html = '<table>' + fragment + '</table><table><tr><td>extra</td></tr></table>';
  assert.deepEqual(parseHtmlClipboardTable(html), [["A\nB", "C"]]);
  assert.deepEqual(parseClipboardContent("", html), [["A\nB", "C"]]);
  assert.equal(looksLikeTabularClipboard("", html), true);
});

test("HTML clipboard fallback declines skipped malformed markup before or inside a table", () => {
  const ghost = '<table><tr><td>GHOST</td><td>ROW</td></tr></table>';
  const fixtures = [
    '<!-- ' + ghost,
    '<div title="' + ghost,
    "<div title='" + ghost,
    '<table><tr><td>A<!-- </td><td>GHOST</td></tr></table>',
    '<tr><td>GHOST</td><td>ROW</td></tr><!-- unfinished',
    '<tr><td>GHOST</td><td>ROW</td></tr><div title="unfinished',
  ];
  for (const html of fixtures) {
    assert.deepEqual(parseHtmlClipboardTable(html), [], html);
    assert.deepEqual(parseClipboardContent("KEEP", html), [["KEEP"]], html);
    assert.deepEqual(parseClipboardContent("", html), [], html);
    assert.equal(looksLikeTabularClipboard("KEEP", html), false, html);
  }
});

test("HTML clipboard fallback keeps complete first tables and valid text/markup boundaries", () => {
  const row = '<tr><td>A<br>B</td><td>1 < 3 &amp; &lt;tag&gt;</td></tr>';
  const expected = [["A\nB", "1 < 3 & <tag>"]];
  const table = '<table>' + row + '</table>';
  for (const html of [row, table, table + '<!-- unfinished', table + '<div title="unfinished', '<!DOCTYPE html><html><head><style><!-- td { color: red; } --></style></head><body>' + table + '</body></html>']) {
    assert.deepEqual(parseHtmlClipboardTable(html), expected, html);
    assert.deepEqual(parseClipboardContent("", html), expected, html);
    assert.equal(looksLikeTabularClipboard("", html), true, html);
  }
  const balanced = '<table><tr><td>A<!-- <tr><td>FAKE</td></tr> --><span title="<br>">B</span></td><td>C</td></tr></table>';
  assert.deepEqual(parseHtmlClipboardTable(balanced), [["AB", "C"]]);
});

test("HTML clipboard fallback after a DOMParser exception still declines malformed markup", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "DOMParser");
  try {
    Object.defineProperty(globalThis, "DOMParser", {
      configurable: true,
      value: class DOMParserStub {
        parseFromString() { throw new Error("parser unavailable"); }
      },
    });
    const html = '<!-- <table><tr><td>GHOST</td><td>ROW</td></tr></table>';
    assert.deepEqual(parseClipboardContent("KEEP", html), [["KEEP"]]);
    assert.equal(looksLikeTabularClipboard("KEEP", html), false);
  } finally {
    if (previous) Object.defineProperty(globalThis, "DOMParser", previous);
    else delete globalThis.DOMParser;
  }
});

test("HTML clipboard fallback declines ambiguous declaration and processing instruction boundaries", () => {
  const ghost = '<table><tr><td>GHOST</td><td>ROW</td></tr></table>';
  const fixtures = [
    '<!bogus ' + ghost,
    '<?xml ' + ghost,
    '<![CDATA[' + ghost + ']]>',
    '<table><tr><td>A<!bogus </td><td>GHOST</td></tr></table>',
    '<table><tr><td>A<?xml </td><td>GHOST</td></tr></table>',
    '<tr><td>GHOST</td><td>ROW</td></tr><!unfinished',
    '<tr><td>GHOST</td><td>ROW</td></tr><?unfinished',
    '<tr><td>GHOST</td><td>ROW</td></tr><!-- unfinished >',
  ];
  for (const html of fixtures) {
    assert.deepEqual(parseHtmlClipboardTable(html), [], html);
    assert.deepEqual(parseClipboardContent("KEEP", html), [["KEEP"]], html);
    assert.deepEqual(parseClipboardContent("", html), [], html);
    assert.equal(looksLikeTabularClipboard("KEEP", html), false, html);
  }
});

test("HTML clipboard fallback retains simple declarations, escaped text and the complete first table", () => {
  const table = '<table><tr><td>A<br>B</td><td>&lt;!bogus &lt;?xml</td></tr></table>';
  const expected = [["A\nB", "<!bogus <?xml"]];
  for (const html of [table, '<!DOCTYPE html>' + table, '<!bogus ok>' + table,
    '<?xml version="1.0"?>' + table, '<!-- <!bogus <table> -->' + table,
    table + '<!bogus <table>', table + '<?unfinished']) {
    assert.deepEqual(parseHtmlClipboardTable(html), expected, html);
    assert.deepEqual(parseClipboardContent("", html), expected, html);
    assert.equal(looksLikeTabularClipboard("", html), true, html);
  }
  const simple = '<table><tr><td>A<!bogus ok>B<?xml ok>C<br>D</td><td>E</td></tr></table>';
  assert.deepEqual(parseHtmlClipboardTable(simple), [["ABC\nD", "E"]]);
});

test("HTML clipboard fallback declines ambiguous declarations after a DOMParser exception", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "DOMParser");
  try {
    Object.defineProperty(globalThis, "DOMParser", {
      configurable: true,
      value: class DOMParserStub {
        parseFromString() { throw new Error("parser unavailable"); }
      },
    });
    const html = '<?xml <table><tr><td>GHOST</td><td>ROW</td></tr></table>';
    assert.deepEqual(parseClipboardContent("KEEP", html), [["KEEP"]]);
    assert.equal(looksLikeTabularClipboard("KEEP", html), false);
  } finally {
    if (previous) Object.defineProperty(globalThis, "DOMParser", previous);
    else delete globalThis.DOMParser;
  }
});
