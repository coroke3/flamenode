/**
 * Compatibility bridge for legacy callers (MIG-0202).
 * Canonical implementation: packages/ui/src/layout/bodyScrollLock.ts
 * Remove when the Next app is retired (Phase 9). This path and the `@flamenode/ui`
 * dist build share one lock state on globalThis (packages/ui/test/dialog.dom.test.mjs).
 */
export {
  acquireBodyScrollLock,
  getBodyScrollLockCountForTest,
} from "@flamenode/ui/layout/bodyScrollLock.ts";
