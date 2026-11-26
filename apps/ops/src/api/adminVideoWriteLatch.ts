// MIG-0730 U02bm: UNMOUNTED Ops SA-084/SA-085 in-module write coordination.
// This is only best-effort deduplication within one JavaScript module graph:
// it cannot replace authenticated D1 compare-and-swap across tabs/devices.
const activeVideoWrites = new Map<string, symbol>();

/**
 * Claim a video before making any admin member or collaborator HTTP write.
 * The returned closure releases only its own claim, even when called twice.
 */
export function tryAcquireAdminVideoWrite(videoId: string): (() => void) | null {
  if (activeVideoWrites.has(videoId)) return null;
  const token = Symbol(videoId);
  activeVideoWrites.set(videoId, token);
  return () => {
    if (activeVideoWrites.get(videoId) === token) {
      activeVideoWrites.delete(videoId);
    }
  };
}
