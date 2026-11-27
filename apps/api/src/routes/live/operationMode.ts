/**
 * MIG-0604 U02: public operation_mode resolution for live APIs.
 * Mirrors CURRENT src/lib/operationMode/{publicMode,publicModeCore,kvMirror,
 * kvMirrorCore}.ts. Priority: FORCE_STATIC_ONLY env > isolate cache (30s) >
 * KV mirror (30s isolate mirror, 5s on error) > D1 system_settings (only when
 * allowed) > normal. Isolate caches hold resolved plain values only.
 */
import { isOperationMode, type OperationMode } from "@flamenode/domain/admin";

export const OPERATION_MODE_KV_KEY = "operation_mode:mirror";
export const ISOLATE_MODE_TTL_MS = 30_000;
/** Preserve CURRENT mode semantics even when a legacy KV reason is large.
 * Rejecting the entire JSON by length can silently turn maintenance/static_only
 * into normal. The banner bounds the reason separately before serialization.
 * Normal writes already limit reason length; oversized legacy mirrors are rare.
 */
const KV_CACHE_TTL_MS = 30_000;
const KV_ERROR_CACHE_TTL_MS = 5_000;

export type OperationModeEnv = {
  DB?: D1Database;
  KV?: KVNamespace;
  FORCE_STATIC_ONLY?: string;
};

let isolateMode: { mode: OperationMode | null; expiresAt: number } = {
  mode: null,
  expiresAt: 0,
};
// Preserve the parsed reason alongside the mode. CURRENT caches the entire
// mirror for 30 seconds, so the public banner must not bypass it with a
// separate KV.get on every request.
let kvCache: { mirror: ParsedOperationModeKvMirror | null; expiresAt: number } = {
  mirror: null,
  expiresAt: 0,
};
let kvMirrorInFlight: Promise<ParsedOperationModeKvMirror | null> | null = null;

export function resetOperationModeCachesForTests(): void {
  isolateMode = { mode: null, expiresAt: 0 };
  kvCache = { mirror: null, expiresAt: 0 };
  kvMirrorInFlight = null;
}

/** FORCE_STATIC_ONLY env: 1 / true / yes (case-insensitive). */
export function isForceStaticOnlyEnv(raw: string | undefined): boolean {
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export type ParsedOperationModeKvMirror = {
  mode: OperationMode;
  updated_at: number;
  reason?: string | null;
};

/** ZERO_1102 rule 78: request-time JSON.parse is capped at 64 KiB. */
export const KV_MIRROR_PARSE_LIMIT = 64 * 1024;
/**
 * Oversized legacy mirrors: validate the complete JSON grammar without
 * constructing the large reason or calling JSON.parse on >64 KiB input.
 * The state machine uses O(nesting) memory and checks top-level keys only.
 * Duplicate properties follow JSON.parse's last-key-wins semantics.
 * Small key/mode tokens are decoded with JSON.parse (at most 128 chars).
 */
function scanOversizedKvMirror(raw: string): ParsedOperationModeKvMirror | null {
  let i = 0;
  const n = raw.length;
  // Only JSON's four ASCII whitespace characters are allowed. Skip long
  // runs natively rather than paying a JS iteration for every code unit.
  const whitespaceRun = /[ \t\n\r]+/y;
  const whitespace = (): void => {
    const c = raw[i];
    if (c !== " " && c !== "\t" && c !== "\n" && c !== "\r") return;
    whitespaceRun.lastIndex = i;
    if (whitespaceRun.test(raw)) i = whitespaceRun.lastIndex;
  };
  // Keep the fast native search for ordinary text. At an escape, consume
  // bounded batches of valid escapes and short plain runs; this avoids one
  // JS iteration per escape in legacy mirrors without an unbounded regex
  // repetition stack. Longer plain runs use stringSpecial again.
  const stringSpecial = /["\\\u0000-\u001f]/g;
  const escapedRun = /(?:\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4})[^"\\\u0000-\u001f]{0,16}){1,256}/y;
  const stringToken = (): [number, number] => {
    const start = i;
    if (raw[i++] !== '"') throw new Error("quote");
    stringSpecial.lastIndex = i;
    while (true) {
      const match = stringSpecial.exec(raw);
      if (!match) throw new Error("unterminated string");
      i = stringSpecial.lastIndex;
      if (match[0] === '"') return [start, i];
      if (match[0] !== "\\") throw new Error("control");
      escapedRun.lastIndex = i - 1;
      if (!escapedRun.test(raw)) throw new Error("invalid escape");
      i = escapedRun.lastIndex;
      stringSpecial.lastIndex = i;
    }
  };
  const smallString = (token: [number, number]): string | null =>
    token[1] - token[0] <= 128 ? JSON.parse(raw.slice(token[0], token[1])) as string : null;
  // A sticky match consumes a valid JSON number prefix. The enclosing
  // array/object state still rejects any invalid suffix (01, 1., 1e+, etc.).
  const numberPattern = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
  const numberToken = (): [number, number] => {
    const start = i;
    numberPattern.lastIndex = i;
    if (!numberPattern.test(raw)) throw new Error("number");
    i = numberPattern.lastIndex;
    return [start, i];
  };
  type Frame = { kind: "object" | "array"; state: string; root: boolean; key: string | null };
  const stack: Frame[] = [];
  let mode: string | null = null;
  let updatedAt = NaN;
  const value = (rootKey: string | null): void => {
    whitespace();
    const c = raw[i];
    if (c === "{" || c === "[") {
      i++;
      stack.push({ kind: c === "{" ? "object" : "array",
        state: c === "{" ? "firstKey" : "firstValue", root: false, key: null });
      if (rootKey === "mode") mode = null;
      if (rootKey === "updated_at") updatedAt = NaN;
      return;
    }
    if (c === '"') {
      const token = stringToken();
      if (rootKey === "mode") mode = smallString(token);
      if (rootKey === "updated_at") updatedAt = NaN;
      return;
    }
    if (c === "-" || (c >= "0" && c <= "9")) {
      const token = numberToken();
      if (rootKey === "mode") mode = null;
      if (rootKey === "updated_at") updatedAt =
        Number(raw.slice(token[0], token[1]));
      return;
    }
    for (const literal of ["true", "false", "null"]) {
      if (!raw.startsWith(literal, i)) continue;
      i += literal.length;
      if (rootKey === "mode") mode = null;
      if (rootKey === "updated_at") updatedAt = NaN;
      return;
    }
    throw new Error("value");
  };
  try {
    whitespace();
    if (raw[i++] !== "{") return null;
    stack.push({ kind: "object", state: "firstKey", root: true, key: null });
    while (stack.length) {
      whitespace();
      const frame = stack[stack.length - 1];
      if (frame.kind === "object") {
        if (frame.state === "firstKey" || frame.state === "key") {
          if (raw[i] === "}" && frame.state === "firstKey") { i++; stack.pop(); continue; }
          if (raw[i] !== '"') return null;
          const token = stringToken();
          frame.key = frame.root ? smallString(token) : null;
          frame.state = "colon";
          continue;
        }
        if (frame.state === "colon") {
          if (raw[i++] !== ":") return null;
          frame.state = "value";
          continue;
        }
        if (frame.state === "value") {
          frame.state = "after";
          value(frame.root ? frame.key : null);
          continue;
        }
        if (raw[i] === ",") { i++; frame.state = "key"; continue; }
        if (raw[i] === "}") { i++; stack.pop(); continue; }
        return null;
      }
      if (frame.state === "firstValue" && raw[i] === "]") { i++; stack.pop(); continue; }
      if (frame.state === "firstValue" || frame.state === "value") {
        frame.state = "after";
        value(null);
        continue;
      }
      if (raw[i] === ",") { i++; frame.state = "value"; continue; }
      if (raw[i] === "]") { i++; stack.pop(); continue; }
      return null;
    }
    whitespace();
    if (i !== n || !isOperationMode(mode) || !Number.isFinite(updatedAt)) return null;
    return { mode, updated_at: updatedAt, reason: null };
  } catch {
    return null;
  }
}

/** Mirrors CURRENT kvMirrorCore: invalid reason is absent, not coerced. */
export function parseKvMirror(raw: string | null): ParsedOperationModeKvMirror | null {
  if (!raw) return null;
  // String.length counts UTF-16 code units, not UTF-8 bytes. A unit
  // occupies at most three UTF-8 bytes (a surrogate pair uses four total).
  // Only borderline inputs need encoding; encodeInto caps the temporary
  // allocation at the parse limit and stops before an incomplete code point.
  if (
    raw.length > KV_MIRROR_PARSE_LIMIT ||
    (raw.length > Math.floor(KV_MIRROR_PARSE_LIMIT / 3) &&
      new TextEncoder().encodeInto(raw, new Uint8Array(KV_MIRROR_PARSE_LIMIT)).read !== raw.length)
  ) return scanOversizedKvMirror(raw);
  try {
    const parsed = JSON.parse(raw) as {
      mode?: unknown;
      updated_at?: unknown;
      reason?: unknown;
    };
    if (!isOperationMode(parsed.mode)) return null;
    if (typeof parsed.updated_at !== "number" || !Number.isFinite(parsed.updated_at)) {
      return null;
    }
    return {
      mode: parsed.mode,
      updated_at: parsed.updated_at,
      reason:
        typeof parsed.reason === "string" || parsed.reason === null
          ? parsed.reason
          : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Return a bounded-stale mirror for both the live mode resolver and public
 * banner. A single cache avoids two KV reads on a cold banner request and an
 * additional KV read on every warm request. Errors cache for just 5 seconds.
 */
export async function readOperationModeKvMirror(
  kv: KVNamespace | undefined,
): Promise<ParsedOperationModeKvMirror | null> {
  const now = Date.now();
  if (now < kvCache.expiresAt) return kvCache.mirror;
  // Share a cold KV lookup across requests in the same isolate. Otherwise
  // concurrent banners can each read KV before either populates the cache.
  if (kvMirrorInFlight) return kvMirrorInFlight;
  if (!kv) {
    kvCache = { mirror: null, expiresAt: now + KV_ERROR_CACHE_TTL_MS };
    return null;
  }
  const pending = (async (): Promise<ParsedOperationModeKvMirror | null> => {
    try {
      const raw = await kv.get(OPERATION_MODE_KV_KEY, {
        cacheTtl: KV_CACHE_TTL_MS / 1000,
      });
      const mirror = typeof raw === "string" ? parseKvMirror(raw) : null;
      kvCache = { mirror, expiresAt: Date.now() + KV_CACHE_TTL_MS };
      return mirror;
    } catch {
      kvCache = { mirror: null, expiresAt: Date.now() + KV_ERROR_CACHE_TTL_MS };
      return null;
    }
  })();
  kvMirrorInFlight = pending;
  try {
    return await pending;
  } finally {
    if (kvMirrorInFlight === pending) kvMirrorInFlight = null;
  }
}

/** Treat a throwing KV binding accessor like an unavailable KV read.
 * The public mode/banner must never expose binding acquisition exceptions or
 * fall through to D1 solely because a property getter throws.
 */
export function getOperationModeKvBinding(env: OperationModeEnv): KVNamespace | undefined {
  try {
    return env.KV;
  } catch {
    return undefined;
  }
}

async function readKvMode(kv: KVNamespace | undefined): Promise<OperationMode | null> {
  return (await readOperationModeKvMirror(kv))?.mode ?? null;
}

async function readD1Mode(db: D1Database): Promise<OperationMode | null> {
  try {
    const row = await db
      .prepare("SELECT operation_mode FROM system_settings WHERE id = ? LIMIT 1")
      .bind("default")
      .first<{ operation_mode: string | null }>();
    if (!row) return null;
    // resolveOperationMode: unknown value -> normal
    return isOperationMode(row.operation_mode) ? row.operation_mode : "normal";
  } catch {
    return null;
  }
}

function remember(mode: OperationMode): OperationMode {
  isolateMode = { mode, expiresAt: Date.now() + ISOLATE_MODE_TTL_MS };
  return mode;
}

export async function resolvePublicOperationMode(
  env: OperationModeEnv,
  options: { allowD1?: boolean } = {},
): Promise<OperationMode> {
  if (isForceStaticOnlyEnv(env.FORCE_STATIC_ONLY)) return remember("static_only");
  if (isolateMode.mode && Date.now() < isolateMode.expiresAt) return isolateMode.mode;
  const fromKv = await readKvMode(getOperationModeKvBinding(env));
  if (fromKv) return remember(fromKv);
  if (options.allowD1 && env.DB) {
    const fromD1 = await readD1Mode(env.DB);
    if (fromD1) return remember(fromD1);
  }
  return remember("normal");
}

/** CURRENT src/lib/operationMode/policy.ts isLiveApiEnabled. */
export function isLiveApiEnabled(mode: OperationMode): boolean {
  return mode === "normal" || mode === "economy" || mode === "read_only";
}
