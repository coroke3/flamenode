/**
 * MIG-0638 U01b: framework-neutral bounded JSON reader for spreadsheet writes/import.
 * Exact CURRENT implementation: src/lib/admin/spreadsheet/routeHandler.ts (excluding Next.js guard/response code).
 * Must be called only after Hono admin/write guards; no routes are mounted by this module.
 */
export const SPREADSHEET_JSON_BODY_MAX_BYTES = 8 * 1024 * 1024;

function invalidJson(): Error {
  return new Error("invalid_json");
}

function assertSpreadsheetJsonContentType(req: Request): void {
  const parts = (req.headers.get("content-type") ?? "")
    .split(";")
    .map((part) => part.trim());
  if (parts.shift()?.toLowerCase() !== "application/json") {
    throw invalidJson();
  }
  if (parts.length === 0) return;
  if (parts.length !== 1) throw invalidJson();

  const charset = /^charset\s*=\s*(?:"utf-8"|utf-8)$/i.exec(parts[0]);
  if (!charset) throw invalidJson();
}

function assertSpreadsheetContentLength(req: Request): void {
  const raw = req.headers.get("content-length");
  if (raw === null) return;
  const normalized = raw.trim();
  if (!/^\d+$/.test(normalized)) throw invalidJson();
  if (BigInt(normalized) > BigInt(SPREADSHEET_JSON_BODY_MAX_BYTES)) {
    throw new Error("payload_too_large");
  }
}

/** JSON bodyをUTF-8 byte上限付きstreamで読み込む。 */
export async function readSpreadsheetJsonBody<T>(req: Request): Promise<T> {
  assertSpreadsheetJsonContentType(req);
  assertSpreadsheetContentLength(req);
  if (!req.body) throw invalidJson();

  const reader = req.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let byteLength = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > SPREADSHEET_JSON_BODY_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("payload_too_large");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    if (!text.trim()) throw invalidJson();
    return JSON.parse(text) as T;
  } catch (error) {
    if (error instanceof Error && error.message === "payload_too_large") {
      throw error;
    }
    throw invalidJson();
  } finally {
    reader.releaseLock();
  }
}
