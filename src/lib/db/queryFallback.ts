export function isMissingColumnError(
  err: unknown,
  columnName: string,
): boolean {
  const seen = new Set<unknown>();
  let current: unknown = err;
  const pattern = new RegExp(`no such column: .*\\b${columnName}\\b`, "i");

  for (let depth = 0; depth < 6 && current != null; depth++) {
    if (seen.has(current)) break;
    seen.add(current);
    if (typeof current === "object") {
      const value = current as { message?: unknown; cause?: unknown };
      if (typeof value.message === "string" && pattern.test(value.message)) {
        return true;
      }
      current = value.cause;
      continue;
    }
    break;
  }

  return false;
}

export async function withMissingColumnFallback<T>(
  columnName: string,
  run: (includeColumn: boolean) => Promise<T>,
): Promise<T> {
  try {
    return await run(true);
  } catch (err) {
    if (!isMissingColumnError(err, columnName)) throw err;
    return run(false);
  }
}
