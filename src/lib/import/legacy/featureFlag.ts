/**
 * legacy import は preview token を HMAC 署名できる場合だけ有効化する。
 * feature flag だけで危険な書込み入口を開けないよう fail-closed にする。
 */
export function getLegacyImportPreviewSecret(): string | null {
  const secret = process.env.LEGACY_IMPORT_PREVIEW_SECRET?.trim();
  return secret && secret.length >= 32 ? secret : null;
}

export function isLegacyImportToolEnabled(): boolean {
  return (
    process.env.ENABLE_LEGACY_IMPORT_TOOL === "true" &&
    getLegacyImportPreviewSecret() !== null
  );
}
