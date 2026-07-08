function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, child]) => [k, stableValue(child)]),
    );
  }
  return value;
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function stableSha256(value: unknown): Promise<string> {
  const body = JSON.stringify(stableValue(value));
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(body),
  );
  return toHex(digest);
}

/** ファイルリストのハッシュ (名前・サイズ・内容) */
export async function hashFiles(
  files: Array<{ name: string; content: string; size: number }>,
): Promise<string> {
  const parts = await Promise.all(
    [...files]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(async (f) => ({
        name: f.name,
        size: f.size,
        contentHash: await stableSha256(f.content),
      })),
  );
  return stableSha256(parts);
}
