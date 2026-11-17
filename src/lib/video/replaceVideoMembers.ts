// MIG-0650 U03v: CURRENT compatibility bridge; canonical member replacement
// D1 read + CAS/strict audit planning now lives in @flamenode/server-core.
// The caller still supplies a guarded request-scoped DB and commits the whole
// plan atomically with metadata/queue, never through this bridge alone.
export { buildReplaceVideoMembersPlan } from "@flamenode/server-core/video/replaceVideoMembers";
export {
  chunkRowsByJsonByteSize,
  jsonUtf8ByteLength,
  VIDEO_CHAPTER_JSON_MAX_BYTES,
  VIDEO_CHAPTER_JSON_MAX_BINDS,
} from "@flamenode/server-core/video/chapterJsonChunking";
