/**
 * 公開用静的 JSON 生成の実装モジュール。
 * deploy対象は content-jobs だけであり、この旧エントリポイントは持たない。
 */
export { processStaticRebuildQueue } from "./queue.ts";
export type { Env } from "./queue.ts";
