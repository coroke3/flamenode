import { PARSER_VERSION, SCHEMA_VERSION } from "./constants.ts";
import type { ImportStrategy } from "./types.ts";

export const LEGACY_IMPORT_PREVIEW_TTL_SECONDS = 15 * 60;

export interface PreviewTokenParams {
  batchId: string;
  nonce: string;
  fileHash: string;
  planHash: string;
  strategy: ImportStrategy;
  importMode: string;
  enqueueStaticRebuild: boolean;
  userId: string;
  anchorNow: number;
  expiresAt: number;
}

export interface LegacyImportPreviewClaims extends PreviewTokenParams {
  parserVersion: string;
  schemaVersion: string;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return new Uint8Array(
    await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(message)),
  );
}

async function verifyHmacSha256(
  secret: string,
  message: string,
  signature: Uint8Array,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  // TS 5.7 の Web Crypto 定義は SharedArrayBuffer を含む view を受け付けないため、
  // 検証前に通常の ArrayBuffer へコピーする。
  const signatureBuffer = Uint8Array.from(signature).buffer;
  return globalThis.crypto.subtle.verify("HMAC", key, signatureBuffer, encoder.encode(message));
}

function isPreviewClaims(value: unknown): value is LegacyImportPreviewClaims {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const claim = value as Record<string, unknown>;
  return (
    typeof claim.batchId === "string" &&
    typeof claim.nonce === "string" &&
    typeof claim.fileHash === "string" &&
    typeof claim.planHash === "string" &&
    (claim.strategy === "create_only" || claim.strategy === "replace_imported" || claim.strategy === "skip_existing") &&
    typeof claim.importMode === "string" &&
    typeof claim.enqueueStaticRebuild === "boolean" &&
    typeof claim.userId === "string" &&
    typeof claim.anchorNow === "number" &&
    Number.isSafeInteger(claim.anchorNow) &&
    typeof claim.expiresAt === "number" &&
    Number.isSafeInteger(claim.expiresAt) &&
    claim.parserVersion === PARSER_VERSION &&
    claim.schemaVersion === SCHEMA_VERSION
  );
}

/**
 * preview record と結び付いた署名トークン。ハッシュだけの決定値ではなく、サーバー秘密値で
 * 署名するため、analyze を通さない apply やフィールド改ざんを受け付けない。
 */
export async function buildPreviewToken(
  params: PreviewTokenParams,
  secret: string,
): Promise<string> {
  const claims: LegacyImportPreviewClaims = {
    ...params,
    parserVersion: PARSER_VERSION,
    schemaVersion: SCHEMA_VERSION,
  };
  const encodedClaims = toBase64Url(new TextEncoder().encode(JSON.stringify(claims)));
  const signature = toBase64Url(await hmacSha256(secret, encodedClaims));
  return `${encodedClaims}.${signature}`;
}

/** null は malformed / 改ざん / 署名不一致を表す。期限判定は route 側で一元化する。 */
export async function verifyPreviewToken(
  token: string,
  secret: string,
): Promise<LegacyImportPreviewClaims | null> {
  const [encodedClaims, encodedSignature, ...rest] = token.split(".");
  if (!encodedClaims || !encodedSignature || rest.length > 0) return null;
  const claimBytes = fromBase64Url(encodedClaims);
  const signature = fromBase64Url(encodedSignature);
  if (!claimBytes || !signature) return null;
  if (!(await verifyHmacSha256(secret, encodedClaims, signature))) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(claimBytes)) as unknown;
    return isPreviewClaims(claims) ? claims : null;
  } catch {
    return null;
  }
}
