/** MIG-0802 U01 (partial): Auth.js redirect callback extracted from CURRENT.
 * Receives the already validated configured authOrigin; never derives an origin
 * from the request Host header. Preserve CURRENT's exact URL behavior.
 */
export function authRedirectTarget(url: string, authOrigin: string): string {
  if (url.startsWith("/")) {
    return `${authOrigin}${url}`;
  }
  try {
    const target = new URL(url);
    if (target.origin === authOrigin) return target.href;
  } catch {
    // Fall back to the same origin and path as CURRENT.
  }
  return `${authOrigin}/dashboard`;
}
