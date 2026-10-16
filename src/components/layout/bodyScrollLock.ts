/**
 * Compatibility bridge for legacy callers (MIG-0202).
 * Canonical implementation: packages/ui/src/layout/bodyScrollLock.ts
 * Remove when the Next app is retired (Phase 9). Until then this path and the
 * `@flamenode/ui` dist build each hold their own lock state, so one page must not
 * use both.
 */
export {
  acquireBodyScrollLock,
  getBodyScrollLockCountForTest,
} from "@flamenode/ui/layout/bodyScrollLock.ts";
