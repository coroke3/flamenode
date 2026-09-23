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
  if (staleMaxAgeSeconds > 0 && age <= staleMaxAgeSeconds) return "stale";
  return "expired";
}

/** Keep bounded LKG envelopes in Cache API long enough to serve their stale window. */
export function publicJsonCacheRetentionTtl(
  freshTtlSeconds: number,
  staleMaxAgeSeconds = 0,
): number {
  return Math.max(1, Math.floor(freshTtlSeconds), Math.floor(staleMaxAgeSeconds));
}
