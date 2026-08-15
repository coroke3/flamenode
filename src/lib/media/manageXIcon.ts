import type { FlameNodeEnv } from "../cloudflare";
import {
  isPublicMediaObjectSafe,
  MAX_PUBLIC_MEDIA_BYTES,
  normalizePublicMediaContentType,
} from "./publicMedia.ts";

/** Manage 用アイコン署名の有効期間。公開 media の cache window を超えない。 */
export const MANAGE_X_ICON_TTL_SECONDS = 5 * 60;
export const MANAGE_X_ICON_SIGNING_BUCKET_SECONDS = 60;
export const MANAGE_X_ICON_VERSION = "1" as const;
export const MANAGE_X_ICON_SIGNING_DOMAIN = "flamenode:manage-x-icon:v1";
export const MANAGE_X_ICON_PATH_PREFIX = "/api/media/manage-x-icon/";
export const MANAGE_X_ICON_MEDIA_PREFIX = "/api/media/";

/** X profile icon として保存される可能性がある namespace だけを許可する。 */
export const MANAGE_X_ICON_NAMESPACES = ["xicons", "x-icons"] as const;

const CONTROL_CHARACTERS = /[\x00-\x1F\x7F]/;
const SAFE_INTEGER_PATTERN = /^[0-9]{1,12}$/;
const MAX_KEY_LENGTH = 1024;
const MAX_SIGNATURE_LENGTH = 128;
const CACHE_CONTROL_PREFIX = "private, max-age=";

type ManageXIconEnv = Pick<FlameNodeEnv, "AUTH_SECRET" | "BUCKET">;

export type ManageXIconUrlOptions = {
  /** テスト・同一時刻の再現用。秒単位の Unix time。 */
  now?: number;
  /** 通常は指定しない。指定時も TTL 上限を超えない。 */
  expiresAt?: number;
};

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > MAX_SIGNATURE_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    return null;
  }
  try {
    const padded =
      value.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (value.length % 4)) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

async function importSigningKey(secret: string): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function signingPayload(key: string, expiresAt: number): string {
  return [
    MANAGE_X_ICON_SIGNING_DOMAIN,
    MANAGE_X_ICON_VERSION,
    key,
    String(expiresAt),
  ].join("\n");
}

function normalizeSecret(secret: string | null | undefined): string | null {
  if (typeof secret !== "string") return null;
  const normalized = secret?.trim() ?? "";
  return normalized ? normalized : null;
}

function nowSeconds(options?: ManageXIconUrlOptions): number {
  const now = options?.now ?? Math.floor(Date.now() / 1000);
  return Number.isSafeInteger(now) && now >= 0 ? now : Math.floor(Date.now() / 1000);
}

/**
 * R2 key の検証。ここで許可しない key は署名が正しくても配信しない。
 * video-icons は作品由来の別 namespace なので、Manage profile icon route
 * では意図的に許可しない。
 */
export function normalizeManageXIconKey(rawKey: string): string | null {
  if (
    typeof rawKey !== "string" ||
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
  const [namespace, ...rest] = rawKey.split("/");
  if (
    !(MANAGE_X_ICON_NAMESPACES as readonly string[]).includes(namespace) ||
    rest.length === 0 ||
    rest.some((segment) => !segment || segment === "." || segment === "..") ||
    rest[0] === "staging"
  ) {
    return null;
  }
  return rawKey;
}

export function extractManageXIconKey(iconUrl: string | null | undefined): string | null {
  const value = iconUrl?.trim() ?? "";
  if (!value.startsWith(MANAGE_X_ICON_MEDIA_PREFIX)) return null;
  return normalizeManageXIconKey(value.slice(MANAGE_X_ICON_MEDIA_PREFIX.length));
}

function isExternalHttpsUrl(value: string): boolean {
  if (CONTROL_CHARACTERS.test(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

async function signKey(
  secret: string,
  key: string,
  expiresAt: number,
): Promise<string> {
  const cryptoKey = await importSigningKey(secret);
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(signingPayload(key, expiresAt)),
  );
  return toBase64Url(new Uint8Array(signature));
}

/** 指定 key の短寿命署名付き Manage URL を生成する。 */
export async function createManageXIconUrl(
  key: string,
  secret: string | null | undefined,
  options: ManageXIconUrlOptions = {},
): Promise<string | null> {
  const normalizedKey = normalizeManageXIconKey(key);
  const signingSecret = normalizeSecret(secret);
  if (!normalizedKey || !signingSecret) return null;

  const now = nowSeconds(options);
  const expiresAt =
    options.expiresAt ??
    (Math.floor(now / MANAGE_X_ICON_SIGNING_BUCKET_SECONDS) +
      Math.ceil(MANAGE_X_ICON_TTL_SECONDS / MANAGE_X_ICON_SIGNING_BUCKET_SECONDS)) *
      MANAGE_X_ICON_SIGNING_BUCKET_SECONDS;
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= now ||
    expiresAt - now > MANAGE_X_ICON_TTL_SECONDS
  ) {
    return null;
  }

  const signature = await signKey(signingSecret, normalizedKey, expiresAt);
  const encodedPath = normalizedKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const query = new URLSearchParams({
    v: MANAGE_X_ICON_VERSION,
    exp: String(expiresAt),
    sig: signature,
  });
  return `${MANAGE_X_ICON_PATH_PREFIX}${encodedPath}?${query.toString()}`;
}

/**
 * x_users.icon_url を Manage 表示用 URL へ変換する。
 * 外部 HTTPS はそのまま、承認済み X の許可 namespace だけ署名する。
 */
export async function resolveManageXIconUrl(args: {
  iconUrl: string | null | undefined;
  approvalStatus: string | null | undefined;
  authSecret: string | null | undefined;
  options?: ManageXIconUrlOptions;
}): Promise<string | null> {
  const value = args.iconUrl?.trim() ?? "";
  if (!value) return null;
  if (isExternalHttpsUrl(value)) return value;
  if (args.approvalStatus !== "approved") return null;
  const key = extractManageXIconKey(value);
  if (!key) return null;
  return createManageXIconUrl(key, args.authSecret, args.options);
}

export function verifyManageXIconSignatureInput(args: {
  key: string;
  expiresAt: number;
  signature: string;
  secret: string | null | undefined;
  now?: number;
}): Promise<boolean> {
  const key = normalizeManageXIconKey(args.key);
  const secret = normalizeSecret(args.secret);
  const now = args.now ?? Math.floor(Date.now() / 1000);
  const signature = fromBase64Url(args.signature);
  if (
    !key ||
    !secret ||
    args.expiresAt < 0 ||
    !Number.isSafeInteger(args.expiresAt) ||
    now < 0 ||
    !Number.isSafeInteger(now) ||
    args.expiresAt <= now ||
    args.expiresAt - now > MANAGE_X_ICON_TTL_SECONDS ||
    !signature ||
    signature.length !== 32
  ) {
    return Promise.resolve(false);
  }
  const signatureBuffer = signature.buffer as ArrayBuffer;
  return importSigningKey(secret).then((cryptoKey) =>
    globalThis.crypto.subtle.verify(
      "HMAC",
      cryptoKey,
      signatureBuffer,
      new TextEncoder().encode(signingPayload(key, args.expiresAt)),
    ),
  );
}

function hasSingleQueryValue(params: URLSearchParams, name: string): boolean {
  return params.getAll(name).length === 1;
}

function isIfNoneMatch(request: Request | undefined, etag: string): boolean {
  const value = request?.headers.get("If-None-Match");
  if (!value) return false;
  return value.split(",").some((candidate) => {
    const normalized = candidate.trim();
    return normalized === "*" || normalized.replace(/^W\//, "") === etag;
  });
}

/** 署名検証後に R2 だけを読む Manage icon response。D1 / R2 LIST は行わない。 */
export async function serveManageXIcon(
  env: ManageXIconEnv,
  rawKey: string,
  request: Request,
): Promise<Response> {
  const key = normalizeManageXIconKey(rawKey);
  if (!key || !env.BUCKET || !env.AUTH_SECRET) {
    return new Response("Not found", { status: 404 });
  }

  let params: URLSearchParams;
  try {
    params = new URL(request.url).searchParams;
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (
    !hasSingleQueryValue(params, "v") ||
    !hasSingleQueryValue(params, "exp") ||
    !hasSingleQueryValue(params, "sig") ||
    params.get("v") !== MANAGE_X_ICON_VERSION
  ) {
    return new Response("Not found", { status: 404 });
  }
  const expiresRaw = params.get("exp") ?? "";
  const signature = params.get("sig") ?? "";
  if (!SAFE_INTEGER_PATTERN.test(expiresRaw)) {
    return new Response("Not found", { status: 404 });
  }
  const expiresAt = Number(expiresRaw);
  const now = Math.floor(Date.now() / 1000);
  let validSignature = false;
  try {
    validSignature = await verifyManageXIconSignatureInput({
      key,
      expiresAt,
      signature,
      secret: env.AUTH_SECRET,
      now,
    });
  } catch {
    validSignature = false;
  }
  if (!validSignature) {
    return new Response("Not found", { status: 404 });
  }

  let object: R2ObjectBody | null;
  try {
    object = await env.BUCKET.get(key);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!object) return new Response("Not found", { status: 404 });

  const contentType = normalizePublicMediaContentType(object.httpMetadata?.contentType);
  if (
    !contentType ||
    !isPublicMediaObjectSafe({ size: object.size, contentType }) ||
    object.size > MAX_PUBLIC_MEDIA_BYTES
  ) {
    return new Response("Not found", { status: 404 });
  }

  const maxAge = Math.max(0, Math.min(MANAGE_X_ICON_TTL_SECONDS, expiresAt - now));
  const headers = new Headers();
  headers.set("content-type", contentType);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", `${CACHE_CONTROL_PREFIX}${maxAge}, must-revalidate`);
  headers.set("x-content-type-options", "nosniff");
  if (isIfNoneMatch(request, object.httpEtag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(object.body as BodyInit, { headers });
}

// Cloudflare's R2ObjectBody type is global, but keeping this alias local makes
// the helper easy to exercise with small test doubles.
type R2ObjectBody = {
  size: number;
  body: unknown;
  httpEtag: string;
  httpMetadata?: { contentType?: string | null };
};
