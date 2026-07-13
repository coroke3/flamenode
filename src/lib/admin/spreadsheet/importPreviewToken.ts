import { buildStableSha256Token } from "../../utils/stableToken.ts";

export const SPREADSHEET_IMPORT_PREVIEW_TTL_SECONDS = 5 * 60;
export const SPREADSHEET_IMPORT_PREVIEW_TOKEN_VERSION = 1;
const TOKEN_PREFIX = "fn-spreadsheet-preview.v1";
const SIGNING_DOMAIN = "flamenode/spreadsheet-import-preview/v1\0";
const CLOCK_SKEW_SECONDS = 30;
const MAX_TOKEN_LENGTH = 16_384;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const NONCE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type SpreadsheetPreviewImportMode = "insert" | "upsert";

export type SpreadsheetPreviewSchemaColumn = {
  name: string;
  type: string;
  notNull: boolean;
  pk: number;
  defaultValue?: string | null;
  generated?: boolean;
  enumValues?: readonly string[];
};

export type SpreadsheetImportPreviewBindingInput = {
  operatorUserId: string;
  table: string;
  mode: SpreadsheetPreviewImportMode;
  columns: string[];
  primaryKeys: string[];
  schemaColumns: SpreadsheetPreviewSchemaColumn[];
  rows: Record<string, string | null>[];
};

export type SpreadsheetImportPreviewBinding = {
  operatorUserId: string;
  table: string;
  mode: SpreadsheetPreviewImportMode;
  columns: string[];
  primaryKeys: string[];
  payloadHash: string;
  schemaFingerprint: string;
};

export type SpreadsheetImportPreviewClaims = SpreadsheetImportPreviewBinding & {
  version: typeof SPREADSHEET_IMPORT_PREVIEW_TOKEN_VERSION;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
};

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
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

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function sign(secret: string, encodedClaims: string): Promise<Uint8Array> {
  const key = await importHmacKey(secret);
  return new Uint8Array(
    await globalThis.crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${SIGNING_DOMAIN}${encodedClaims}`),
    ),
  );
}

async function verifySignature(
  secret: string,
  encodedClaims: string,
  signature: Uint8Array,
): Promise<boolean> {
  const key = await importHmacKey(secret);
  return globalThis.crypto.subtle.verify(
    "HMAC",
    key,
    Uint8Array.from(signature).buffer,
    new TextEncoder().encode(`${SIGNING_DOMAIN}${encodedClaims}`),
  );
}

export function requireSpreadsheetImportPreviewSecret(
  value: string | undefined,
): string {
  const secret = value?.trim() ?? "";
  if (secret.length < 32) throw new Error("preview_unavailable");
  return secret;
}

export async function buildSpreadsheetImportPreviewBinding(
  input: SpreadsheetImportPreviewBindingInput,
): Promise<SpreadsheetImportPreviewBinding> {
  const columns = [...input.columns];
  const primaryKeys = [...input.primaryKeys];
  const [payloadHash, schemaFingerprint] = await Promise.all([
    buildStableSha256Token({
      table: input.table,
      mode: input.mode,
      rows: input.rows,
    }),
    buildStableSha256Token({
      table: input.table,
      columns: input.schemaColumns.map((column) => ({
        name: column.name,
        type: column.type,
        notNull: column.notNull,
        pk: column.pk,
        defaultValue: column.defaultValue ?? null,
        generated: column.generated ?? false,
        enumValues: column.enumValues ? [...column.enumValues] : [],
      })),
      primaryKeys,
    }),
  ]);
  return {
    operatorUserId: input.operatorUserId,
    table: input.table,
    mode: input.mode,
    columns,
    primaryKeys,
    payloadHash,
    schemaFingerprint,
  };
}

export async function issueSpreadsheetImportPreviewToken(
  binding: SpreadsheetImportPreviewBinding,
  secret: string,
  options: { now?: number; nonce?: string } = {},
): Promise<{ token: string; claims: SpreadsheetImportPreviewClaims }> {
  const signingSecret = requireSpreadsheetImportPreviewSecret(secret);
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const nonce = options.nonce ?? globalThis.crypto.randomUUID();
  if (!NONCE_PATTERN.test(nonce)) throw new Error("preview_unavailable");
  const claims: SpreadsheetImportPreviewClaims = {
    version: SPREADSHEET_IMPORT_PREVIEW_TOKEN_VERSION,
    ...binding,
    nonce,
    issuedAt: now,
    expiresAt: now + SPREADSHEET_IMPORT_PREVIEW_TTL_SECONDS,
  };
  const encodedClaims = toBase64Url(
    new TextEncoder().encode(JSON.stringify(claims)),
  );
  const signature = toBase64Url(await sign(signingSecret, encodedClaims));
  return { token: `${TOKEN_PREFIX}.${encodedClaims}.${signature}`, claims };
}

function stringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 200 &&
    value.every((item) => typeof item === "string" && item.length > 0)
  );
}

function isClaims(value: unknown): value is SpreadsheetImportPreviewClaims {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const claim = value as Record<string, unknown>;
  return (
    claim.version === SPREADSHEET_IMPORT_PREVIEW_TOKEN_VERSION &&
    typeof claim.operatorUserId === "string" && claim.operatorUserId.length > 0 &&
    typeof claim.table === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(claim.table) &&
    (claim.mode === "insert" || claim.mode === "upsert") &&
    stringArray(claim.columns) &&
    stringArray(claim.primaryKeys) &&
    typeof claim.payloadHash === "string" && SHA256_HEX.test(claim.payloadHash) &&
    typeof claim.schemaFingerprint === "string" && SHA256_HEX.test(claim.schemaFingerprint) &&
    typeof claim.nonce === "string" && NONCE_PATTERN.test(claim.nonce) &&
    typeof claim.issuedAt === "number" && Number.isSafeInteger(claim.issuedAt) &&
    typeof claim.expiresAt === "number" && Number.isSafeInteger(claim.expiresAt)
  );
}

function sameBinding(
  claims: SpreadsheetImportPreviewClaims,
  expected: SpreadsheetImportPreviewBinding,
): boolean {
  return (
    claims.operatorUserId === expected.operatorUserId &&
    claims.table === expected.table &&
    claims.mode === expected.mode &&
    claims.payloadHash === expected.payloadHash &&
    claims.schemaFingerprint === expected.schemaFingerprint &&
    JSON.stringify(claims.columns) === JSON.stringify(expected.columns) &&
    JSON.stringify(claims.primaryKeys) === JSON.stringify(expected.primaryKeys)
  );
}

export async function verifySpreadsheetImportPreviewToken(
  token: string,
  secret: string,
  expected: SpreadsheetImportPreviewBinding,
  options: { now?: number } = {},
): Promise<SpreadsheetImportPreviewClaims | null> {
  const signingSecret = requireSpreadsheetImportPreviewSecret(secret);
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  const [prefix, version, encodedClaims, encodedSignature, ...rest] = token.split(".");
  if (
    prefix !== "fn-spreadsheet-preview" ||
    version !== "v1" ||
    !encodedClaims ||
    !encodedSignature ||
    rest.length > 0
  ) {
    return null;
  }
  const claimBytes = fromBase64Url(encodedClaims);
  const signature = fromBase64Url(encodedSignature);
  if (!claimBytes || !signature) return null;
  if (!(await verifySignature(signingSecret, encodedClaims, signature))) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(claimBytes)) as unknown;
    if (!isClaims(claims) || !sameBinding(claims, expected)) return null;
    const now = options.now ?? Math.floor(Date.now() / 1000);
    if (claims.issuedAt > now + CLOCK_SKEW_SECONDS) return null;
    if (claims.expiresAt <= now) return null;
    if (
      claims.expiresAt - claims.issuedAt !==
      SPREADSHEET_IMPORT_PREVIEW_TTL_SECONDS
    ) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}
