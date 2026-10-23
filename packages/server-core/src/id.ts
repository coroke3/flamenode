/**
 * 軽量 UUID v4 風 ID 生成。
 * Cloudflare Workers では `crypto.randomUUID` が使えるためこれを優先する。
 */
export function generateId(prefix?: string): string {
  const cryptoApi = globalThis.crypto;
  const uuid =
    typeof cryptoApi?.randomUUID === "function"
      ? cryptoApi.randomUUID()
      : fallback();
  return prefix ? `${prefix}_${uuid}` : uuid;
}

function fallback(): string {
  // RFC4122 v4 を簡易再現
  // `randomUUID` がないランタイムでも Web Crypto の CSPRNG を使う。
  // 乱数源がない場合は、予測可能な ID を発行せず fail closed にする。
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.getRandomValues !== "function") {
    throw new Error("secure_random_unavailable");
  }

  const b = new Uint8Array(16);
  cryptoApi.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (n) => n.toString(16).padStart(2, "0")).join("");
  return (
    hex.slice(0, 8) +
    "-" +
    hex.slice(8, 12) +
    "-" +
    hex.slice(12, 16) +
    "-" +
    hex.slice(16, 20) +
    "-" +
    hex.slice(20)
  );
}
