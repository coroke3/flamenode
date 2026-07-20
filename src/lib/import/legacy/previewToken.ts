import type { CanonicalLegacyPlan, LegacyImportStrategy } from "./normalize";

const TOKEN_TTL_SECONDS = 15 * 60;
const encoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return base64UrlEncode(new Uint8Array(digest));
}

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let diff = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    diff |= leftBytes[index] ^ rightBytes[index];
  }
  return diff === 0;
}

export async function fingerprintLegacyImport(args: {
  plan: CanonicalLegacyPlan;
  eventVisibility: "private" | "public";
  videoVisibility: "private" | "public";
  strategy: LegacyImportStrategy;
}): Promise<string> {
  return sha256(JSON.stringify(args));
}

export async function createLegacyImportPreviewToken(args: {
  secret: string;
  actorAuthUserId: string;
  fingerprint: string;
  now?: number;
}): Promise<string> {
  const now = args.now ?? Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({
    v: 1,
    actor: args.actorAuthUserId,
    fingerprint: args.fingerprint,
    exp: now + TOKEN_TTL_SECONDS,
  });
  const encodedPayload = base64UrlEncode(encoder.encode(payload));
  return `${encodedPayload}.${await hmac(args.secret, encodedPayload)}`;
}

export async function verifyLegacyImportPreviewToken(args: {
  token: string;
  secret: string;
  actorAuthUserId: string;
  fingerprint: string;
  now?: number;
}): Promise<boolean> {
  const [encodedPayload, providedSignature, extra] = args.token.split(".");
  if (!encodedPayload || !providedSignature || extra) return false;
  const expectedSignature = await hmac(args.secret, encodedPayload);
  if (!(await constantTimeEqual(providedSignature, expectedSignature))) return false;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload))) as {
      v?: number;
      actor?: string;
      fingerprint?: string;
      exp?: number;
    };
    const now = args.now ?? Math.floor(Date.now() / 1000);
    return (
      payload.v === 1 &&
      payload.actor === args.actorAuthUserId &&
      payload.fingerprint === args.fingerprint &&
      typeof payload.exp === "number" &&
      payload.exp >= now
    );
  } catch {
    return false;
  }
}
