export type LegacyImportClientPreviewFile = {
  name: string;
  size: number;
  content: string;
  encoding: string;
};

export type LegacyImportClientPreviewKeyInput = {
  files: LegacyImportClientPreviewFile[];
  importMode: string;
  enqueueStaticRebuild: boolean;
  staticRebuildStrategy: string;
  eventStrategy: string;
  videoStrategy: string;
  updateXUsers: boolean;
};

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function buildLegacyImportClientPreviewKey({
  files,
  importMode,
  enqueueStaticRebuild,
  staticRebuildStrategy,
  eventStrategy,
  videoStrategy,
  updateXUsers,
}: LegacyImportClientPreviewKeyInput): string {
  return JSON.stringify({
    files: files.map((file) => ({
      name: file.name,
      size: file.size,
      length: file.content.length,
      encoding: file.encoding,
      contentHash: hashText(file.content),
    })),
    importMode,
    enqueueStaticRebuild,
    staticRebuildStrategy,
    eventStrategy,
    videoStrategy,
    updateXUsers,
  });
}
