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
  assert.match(handler, /if \(busyRef\.current \|\| busy\) return;/);
  assert.match(handler, /setOpen\(false\);/);
  assert.match(handler, /setConfirmText\(""\);/);
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

test("CURRENT reaccept enqueue uses synchronous single-flight guard and releases on failure", () => {
  const ref = source.match(/const busyRef = React\.useRef\(false\);/);
  assert.ok(ref, "useTransition busy alone does not guard reentrant event handlers");
  const handler = source.match(
    /const onSubmit = \(\) => \{([\s\S]*?)\n  \};/,
  )?.[1];
  assert.ok(handler);
  assert.match(
    handler,
    /if \(busyRef\.current \|\| busy \|\| confirmText !== "TERMS" \|\| !content\.trim\(\)\) return;/,
  );
  const latch = handler.indexOf("busyRef.current = true;");
  const transition = handler.indexOf("startTransition(async () => {");
  assert.ok(latch >= 0 && transition > latch, "claim latch before scheduling transition");
  assert.match(handler, /try \{[\s\S]*await broadcastTermsReaccept\(fd\);/);
  assert.match(handler, /catch \{[\s\S]*setMessage\("失敗しました。"\);/);
  assert.match(handler, /finally \{\s*busyRef\.current = false;\s*\}/);
  assert.match(source, /function closeDialog\(\): void \{\s*if \(busyRef\.current \|\| busy\) return;/);
});
