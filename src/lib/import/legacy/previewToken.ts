import { stableSha256 } from "./hash";
import { PARSER_VERSION, SCHEMA_VERSION } from "./constants";
import type { ImportStrategy } from "./types";

export interface PreviewTokenParams {
  fileHash: string;
  strategy: ImportStrategy;
  importMode: string;
  userId: string;
  anchorNow: number;
  featureFlagEnabled: boolean;
}

/**
 * ドライラン時に生成し、apply 時に検証するトークン。
 * ファイル内容・設定・ユーザー・正規化基準時刻が変わると無効になる。
 */
export async function buildPreviewToken(params: PreviewTokenParams): Promise<string> {
  return stableSha256({
    fileHash: params.fileHash,
    strategy: params.strategy,
    importMode: params.importMode,
    userId: params.userId,
    anchorNow: params.anchorNow,
    featureFlagEnabled: params.featureFlagEnabled,
    parserVersion: PARSER_VERSION,
    schemaVersion: SCHEMA_VERSION,
  });
}
