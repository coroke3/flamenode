import "server-only";

function collectErrorText(error: unknown, seen = new Set<unknown>()): string {
  if (error == null || seen.has(error)) return "";
  seen.add(error);

  if (typeof error === "string") return error;
  if (error instanceof Error) {
    const cause = "cause" in error ? collectErrorText(error.cause, seen) : "";
    return `${error.name}\n${error.message}\n${error.stack ?? ""}\n${cause}`;
  }
  if (typeof error === "object") {
    const record = error as Record<string, unknown>;
    const parts = [
      typeof record.message === "string" ? record.message : "",
      typeof record.stack === "string" ? record.stack : "",
      collectErrorText(record.cause, seen),
    ];
    return parts.filter(Boolean).join("\n");
  }
  return String(error);
}

export function isMissingDbObjectError(
  error: unknown,
  objectName: string,
): boolean {
  const text = collectErrorText(error).toLowerCase();
  const object = objectName.toLowerCase();

  return (
    text.includes(`no such table: ${object}`) ||
    text.includes(`no such column: ${object}`) ||
    (text.includes("no such table") && text.includes(object)) ||
    (text.includes("no such column") && text.includes(object))
  );
}
