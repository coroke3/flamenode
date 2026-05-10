/**
 * 軽量 UUID v4 風 ID 生成。
 * Cloudflare Workers では `crypto.randomUUID` が使えるためこれを優先する。
 */
export function generateId(prefix?: string): string {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : fallback();
  return prefix ? `${prefix}_${uuid}` : uuid;
}

function fallback(): string {
  // RFC4122 v4 を簡易再現
  const b = new Array<number>(16);
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = b.map((n) => n.toString(16).padStart(2, "0")).join("");
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

/** 短い英数 ID (アクセシビリティ・URL用)。 */
export function shortId(len = 10): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}
