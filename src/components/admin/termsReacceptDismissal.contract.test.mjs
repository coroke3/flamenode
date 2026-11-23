import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Source-level contract for the CURRENT Next client component. This does not
// replace a mounted browser/React test of its modal lifecycle.
const source = readFileSync(
  new URL("./TermsReacceptBroadcastButton.tsx", import.meta.url),
  "utf8",
);

test("CURRENT reaccept modal dismissal disarms one-time TERMS confirmation", () => {
  const handler = source.match(
    /function closeDialog\(\): void \{([\s\S]*?)\n  \}/,
  )?.[1];
  assert.ok(handler, "both dismissal controls must share closeDialog");
  assert.match(handler, /if \(busy\) return;/);
  assert.match(handler, /setOpen\(false\);/);
  assert.match(handler, /setConfirmText\\(""\\);/);
  assert.doesNotMatch(handler, /setCursor\(|setContent\(|setEnqueuedTotal\(/);

  const backdrop = source.match(
    /role="presentation"[\s\S]*?onClick=\{\(event\) => \{([\s\S]*?)\}\}/,
  )?.[1];
  assert.ok(backdrop, "backdrop click handler is required");
  assert.match(backdrop, /event\.target === event\.currentTarget/);
  assert.match(backdrop, /closeDialog\(\)/);

  assert.match(
    source,
    /onClick=\{closeDialog\}\s+disabled=\{busy\}/,
    "explicit Close button must disarm confirmation too",
  );
});

test("CURRENT reaccept send keeps explicit TERMS, busy and content guards", () => {
  assert.match(
    source,
    /disabled=\{busy \|\| confirmText !== "TERMS" \|\| !content\.trim\(\)\}/,
  );
  assert.match(source, /startTransition\(async \(\) => \{/);
  assert.match(source, /fd\.set\("cursor", String\(cursor\)\)/);
  assert.match(source, /router\.refresh\(\)/);
});
