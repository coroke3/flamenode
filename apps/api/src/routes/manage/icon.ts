// CURRENT: src/lib/media/manageXIcon.ts (normalizeManageXIconKey, extractManageXIconKey, createManageXIconUrl,
// resolveManageXIconUrl). Same algorithm and output (HMAC-SHA256 over the signing payload, 5 min TTL in 60 s buckets).
// Without AUTH_SECRET internal icons resolve to null, exactly as CURRENT (never an unsigned internal URL).
// The Worker secret binding itself is an owner-approved step tracked in MIG-0628.

const TTL_SECONDS = 5 * 60;
const BUCKET_SECONDS = 60;
const VERSION = "1";
const SIGNING_DOMAIN = "flamenode:manage-x-icon:v1";
const PATH_PREFIX = "/api/media/manage-x-icon/";
const MEDIA_PREFIX = "/api/media/";
const NAMESPACES = ["xicons", "x-icons"];
const MAX_KEY_LENGTH = 1024;
const CONTROL_CHARACTERS = /[\x00-\x1F\x7F]/;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function normalizeKey(rawKey: string): string | null {
  if (
    rawKey.length === 0 ||
    rawKey.length > MAX_KEY_LENGTH ||
    rawKey.startsWith("/") ||
    rawKey.endsWith("/") ||
    rawKey.includes("..") ||
    rawKey.includes("\\") ||
    rawKey.includes("?") ||
    rawKey.includes("#") ||
    rawKey.includes("%") ||
    CONTROL_CHARACTERS.test(rawKey)
  ) {
    return null;
  }
  const [namespace = "", ...rest] = rawKey.split("/");
  if (
    !NAMESPACES.includes(namespace) ||
    rest.length === 0 ||
    rest.some((segment) => !segment || segment === "." || segment === "..") ||
    rest[0] === "staging"
  ) {
    return null;
  }
  return rawKey;
}

function isExternalHttpsUrl(value: string): boolean {
  if (CONTROL_CHARACTERS.test(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

async function createSignedUrl(key: string, secret: string, nowOverride?: number): Promise<string | null> {
  const now = nowOverride ?? Math.floor(Date.now() / 1000);
  const expiresAt = (Math.floor(now / BUCKET_SECONDS) + Math.ceil(TTL_SECONDS / BUCKET_SECONDS)) * BUCKET_SECONDS;
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const payload = [SIGNING_DOMAIN, VERSION, key, String(expiresAt)].join("\n");
  const signature = toBase64Url(
    new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(payload))),
  );
  const encodedPath = key.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  const query = new URLSearchParams({ v: VERSION, exp: String(expiresAt), sig: signature });
  return `${PATH_PREFIX}${encodedPath}?${query.toString()}`;
}

/** CURRENT resolveManageXIconUrl: external https unchanged; approved X + allowed namespace -> signed URL. */
export async function resolveManageXIconUrl(args: {
  iconUrl: string | null | undefined;
  approvalStatus: string | null | undefined;
  authSecret: string | null | undefined;
  now?: number;
}): Promise<string | null> {
  const value = args.iconUrl?.trim() ?? "";
  if (!value) return null;
  if (isExternalHttpsUrl(value)) return value;
  if (args.approvalStatus !== "approved") return null;
  if (!value.startsWith(MEDIA_PREFIX)) return null;
  const key = normalizeKey(value.slice(MEDIA_PREFIX.length));
  const secret = typeof args.authSecret === "string" ? args.authSecret.trim() : "";
  if (!key || !secret) return null;
  return createSignedUrl(key, secret, args.now);
}
