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

export function resetOperationModeCachesForTests(): void {
  isolateMode = { mode: null, expiresAt: 0 };
  kvCache = { mirror: null, expiresAt: 0 };
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

/** Mirrors CURRENT kvMirrorCore: invalid reason is absent, not coerced. */
export function parseKvMirror(raw: string | null): ParsedOperationModeKvMirror | null {
  if (!raw) return null;
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
  if (!kv) {
    kvCache = { mirror: null, expiresAt: now + KV_ERROR_CACHE_TTL_MS };
    return null;
  }
  try {
    const raw = await kv.get(OPERATION_MODE_KV_KEY, {
      cacheTtl: KV_CACHE_TTL_MS / 1000,
    });
    const mirror = typeof raw === "string" ? parseKvMirror(raw) : null;
    kvCache = { mirror, expiresAt: now + KV_CACHE_TTL_MS };
    return mirror;
  } catch {
    kvCache = { mirror: null, expiresAt: now + KV_ERROR_CACHE_TTL_MS };
    return null;
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
  const fromKv = await readKvMode(env.KV);
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
