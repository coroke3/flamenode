/**
 * Compatibility bridge for legacy callers (MIG-0202).
 * Canonical implementation: packages/ui/src/layout/bodyScrollLock.ts
 *
 * Preserves state.count and window.scrollTo restoration contract.
 */
import {
  acquireBodyScrollLock as coreAcquire,
  getBodyScrollLockCountForTest as coreGetCount,
} from "@flamenode/ui/layout/bodyScrollLock.ts";

export function acquireBodyScrollLock(): () => void {
  // state.count and window.scrollTo are tracked in @flamenode/ui
  return coreAcquire();
}

export function getBodyScrollLockCountForTest(): number {
  return coreGetCount();
}
