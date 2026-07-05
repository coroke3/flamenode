import { stableSha256 } from "./hash";
import { PARSER_VERSION, SCHEMA_VERSION } from "./constants";
import type { ImportStrategy } from "./types";

export interface PreviewTokenParams {
  fileHash: string;
  planHash: string;
  strategy: ImportStrategy;
  importMode: string;
  userId: string;
  featureFlagEnabled: boolean;
}

/**
 * ドライラン時に生成し、apply 時に検証するトークン。
 * ファイル内容・プラン・設定・ユーザーが変わると無効になる。
 */
export async function buildPreviewToken(params: PreviewTokenParams): Promise<string> {
  return stableSha256({
    fileHash: params.fileHash,
    planHash: params.planHash,
    strategy: params.strategy,
    importMode: params.importMode,
    userId: params.userId,
    featureFlagEnabled: params.featureFlagEnabled,
    parserVersion: PARSER_VERSION,
    schemaVersion: SCHEMA_VERSION,
  });
}
