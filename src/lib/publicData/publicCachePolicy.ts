export type PublicJsonCacheFreshnessEnvelope = {
  stored_at: number;
};

export function publicJsonCacheFreshness(
  envelope: PublicJsonCacheFreshnessEnvelope,
  now: number,
  freshTtlSeconds: number,
  staleMaxAgeSeconds = 0,
): "fresh" | "stale" | "expired" {
  const age = now - envelope.stored_at;
  if (!Number.isFinite(age) || age < 0) return "expired";
  if (age <= Math.max(0, freshTtlSeconds)) return "fresh";
  // A malformed infinite stale window must not retain last-known-good data forever.
  // Infinity for the separate *fresh* TTL is an intentional cache-first default.
  if (
    Number.isFinite(staleMaxAgeSeconds) &&
    staleMaxAgeSeconds > 0 &&
    age <= staleMaxAgeSeconds
  ) return "stale";
  return "expired";
}

function validRetentionSeconds(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const seconds = Math.floor(value);
  return Number.isSafeInteger(seconds) ? seconds : 0;
}

/** Keep bounded LKG envelopes in Cache API long enough to serve their stale window. */
export function publicJsonCacheRetentionTtl(
  freshTtlSeconds: number,
  staleMaxAgeSeconds = 0,
): number {
  // Cache-Control max-age must be a finite integer. A bad optional TTL must
  // not invalidate the other valid window (or create "max-age=Infinity").
  return Math.max(
    1,
    validRetentionSeconds(freshTtlSeconds),
    validRetentionSeconds(staleMaxAgeSeconds),
  );
}
