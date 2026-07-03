import type { SpreadsheetImportMode } from "./query";

export type SpreadsheetImportPreviewTokenPayload = {
  table: string;
  mode: SpreadsheetImportMode;
  columns: string[];
  primaryKeys: string[];
  rows: Record<string, string | null>[];
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function buildSpreadsheetImportPreviewToken(
  payload: SpreadsheetImportPreviewTokenPayload,
): Promise<string> {
  const body = JSON.stringify(stableValue(payload));
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(body),
  );
  return toHex(digest);
}
