/** Auth.jsの既定loggerが出すcause.stackにはD1 SQL bind値が含まれ得る。 */
export function logSafeAuthError(error: Error): void {
  let safeType = "AUTH_ERROR";
  try {
    const candidate = error as Error & { type?: unknown };
    const type = candidate.type;
    const errorType: unknown = typeof type === "string" ? type : candidate.name;
    if (typeof errorType === "string" && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(errorType)) {
      safeType = errorType;
    }
  } catch {
    // Error fields may be hostile getters/Proxies. Never inspect them again.
  }

  try {
    console.error(`[auth][error] ${safeType}`);
  } catch {
    // Diagnostics must not replace the original authentication outcome.
  }
}
