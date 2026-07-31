import {
  withDeduplicatingR2,
  ArtifactHashCache,
} from "../json-generator/r2Dedup.ts";
import { withD1Budget, type EnvWithD1Budget } from "./d1Budget.ts";
import { withSerializedD1 } from "./serializedD1.ts";

type BaseRebuildEnv = {
  DB: D1Database;
  R2: R2Bucket;
  KV: KVNamespace;
};

export type RebuildWorkerEnv = EnvWithD1Budget<
  ReturnType<typeof withDeduplicatingR2<BaseRebuildEnv & { artifactHashCache: ArtifactHashCache }>>
>;

/** 静的 JSON 再生成用の D1 直列化・予算計測・R2 dedup 環境。 */
export function rebuildEnvironment(env: BaseRebuildEnv): RebuildWorkerEnv {
  const artifactHashCache = new ArtifactHashCache();
  return withDeduplicatingR2(
    withD1Budget(withSerializedD1({ ...env, artifactHashCache })),
  );
}
