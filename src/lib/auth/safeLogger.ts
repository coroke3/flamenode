/** Auth.jsの既定loggerが出すcause.stackにはD1 SQL bind値が含まれ得る。 */
export function logSafeAuthError(error: Error): void {
  const candidate = error as Error & { type?: unknown };
  const errorType =
    typeof candidate.type === "string" ? candidate.type : error.name;
  const safeType = /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(errorType)
    ? errorType
    : "AUTH_ERROR";
  console.error(`[auth][error] ${safeType}`);
}
