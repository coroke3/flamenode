import "server-only";

import {
  loadPublicJson,
  type PublicJsonLoadOptions,
  type PublicJsonLoadResult,
} from "./loader";

interface PublicJsonLoaderConfig<TPayload, TResult> {
  r2Key: (id: string) => string;
  targetType: PublicJsonLoadOptions["targetType"];
  targetId?: (id: string) => string;
  reason: string;
  normalize: (payload: TPayload) => TResult | null;
}

export function createPublicJsonLoader<TPayload, TResult>({
  r2Key,
  targetType,
  targetId = (id) => id,
  reason,
  normalize,
}: PublicJsonLoaderConfig<
  TPayload,
  TResult
>): (id: string) => Promise<PublicJsonLoadResult<TResult>> {
  return async (id) => {
    const result = await loadPublicJson<TPayload>({
      r2Key: r2Key(id),
      targetType,
      targetId: targetId(id),
      reason,
    });

    return {
      ...result,
      data:
        result.data == null
          ? null
          : normalize(result.data),
    };
  };
}
