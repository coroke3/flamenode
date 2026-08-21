import { ArtifactHashCache } from "../json-generator/r2Dedup.ts";
import { withD1Budget, type EnvWithD1Budget } from "./d1Budget.ts";
import { withSerializedD1 } from "./serializedD1.ts";

type BaseRebuildEnv = {
  DB: D1Database;
  R2: R2Bucket;
  KV: KVNamespace;
};

export type RebuildWorkerEnv = EnvWithD1Budget<
  BaseRebuildEnv & { artifactHashCache: ArtifactHashCache }
>;

/** 静的 JSON 再生成用の D1 直列化・予算計測・artifact hash cache 環境。 */
export function rebuildEnvironment(env: BaseRebuildEnv): RebuildWorkerEnv {
  const artifactHashCache = new ArtifactHashCache();
  // Generator writers perform the hash check at their write boundary.  Keep
  // R2 raw here so an explicit `deduplicate: false` (immutable v2 pages) is
  // not defeated by a second proxy-level D1/R2 probe.
  return withD1Budget(withSerializedD1({ ...env, artifactHashCache }));
}
