import "server-only";

import { eq } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { systemSettings } from "@/lib/db/schema";
import { getEnv } from "@/lib/cloudflare";
import { readOperationModeKvMirror } from "./kvMirror";
import { resolveOperationMode } from "./resolve";
import type { OperationMode } from "./types";
import {
  readIsolateModeCache,
  resolveForcedOperationMode as resolveForcedOperationModeFromRaw,
  writeIsolateModeCache,
} from "./publicModeCore";

export {
  isForceStaticOnlyEnv,
  resetPublicOperationModeCacheForTests,
} from "./publicModeCore";

export type ResolvePublicOperationModeOptions = {
  allowD1?: boolean;
  db?: DB | null;
};

function readForceStaticOnlyRaw(): string | undefined {
  if (process.env.FORCE_STATIC_ONLY) return process.env.FORCE_STATIC_ONLY;
  try {
    return getEnv().FORCE_STATIC_ONLY;
  } catch {
    return undefined;
  }
}

export function resolveForcedOperationMode(): OperationMode | null {
  return resolveForcedOperationModeFromRaw(readForceStaticOnlyRaw());
}

async function readOperationModeFromD1(db: DB): Promise<OperationMode | null> {
  try {
    const row = await db
      .select({ operation_mode: systemSettings.operation_mode })
      .from(systemSettings)
      .where(eq(systemSettings.id, "default"))
      .limit(1);
    if (!row[0]) return null;
    return resolveOperationMode(row[0]);
  } catch {
    return null;
  }
}

/**
 * 公開読取向け operation_mode 解決。
 *
 * 優先順位:
 * 1. FORCE_STATIC_ONLY / 強制 env
 * 2. isolate 短時間キャッシュ
 * 3. KV 複製
 * 4. allowD1 時のみ D1 system_settings
 * 5. すべて失敗 → static_only（normal へは倒さない）
 *
 * 手順 5 の fail-closed はインフラ障害時の配信安全策であり、
 * Cloudflare 使用量に基づく自動 CostGuard ではない。
 *
 * KV と D1 が不一致のとき:
 * 強制 env > isolate TTL 内キャッシュ > KV > D1
 */
export async function resolvePublicOperationMode(
  options: ResolvePublicOperationModeOptions = {},
): Promise<OperationMode> {
  const forced = resolveForcedOperationMode();
  if (forced) {
    writeIsolateModeCache(forced);
    return forced;
  }

  const cached = readIsolateModeCache();
  if (cached) return cached;

  const kvMirror = await readOperationModeKvMirror();
  if (kvMirror) {
    writeIsolateModeCache(kvMirror.mode);
    return kvMirror.mode;
  }

  if (options.allowD1 && options.db) {
    const fromD1 = await readOperationModeFromD1(options.db);
    if (fromD1) {
      writeIsolateModeCache(fromD1);
      return fromD1;
    }
  }

  const fallback: OperationMode = "static_only";
  writeIsolateModeCache(fallback);
  return fallback;
}

export type CostGuardBannerSnapshot = {
  mode: OperationMode;
  reason: string | null;
};

/** 公開バナー向け。D1 を読まず env / isolate / KV のみ参照する。 */
export async function resolveCostGuardBannerSnapshot(): Promise<CostGuardBannerSnapshot | null> {
  const mode = await resolvePublicOperationMode({ allowD1: false });
  if (mode === "normal") return null;

  const kvMirror = await readOperationModeKvMirror();
  return {
    mode,
    reason: kvMirror?.reason ?? null,
  };
}
