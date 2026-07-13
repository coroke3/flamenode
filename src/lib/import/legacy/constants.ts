export const MAX_IMPORT_FILES = 12;
export const MAX_IMPORT_TOTAL_BYTES =
  6 * 1024 * 1024;
export const MAX_PREVIEW_ROWS = 100;

export const LEGACY_IMPORT_ENTITY_CAPS = {
  events: 4,
  eventStaff: 8,
  eventCustomQuestions: 12,
  videos: 4,
  videoEvents: 12,

  // 1回のimport plan全体で最大100人。
  // 大規模合作は作品単位で分割して投入する。
  videoMembers: 100,

  videoCustomAnswers: 16,
  videoNormExtras: 4,

  // 100人合作 + 代表投稿者 + イベントスタッフ分
  xUsers: 128,

  youtubeMetadata: 4,
} as const;

export const LEGACY_IMPORT_D1_QUERY_LIMIT = 50;
export const LEGACY_IMPORT_FINALIZE_QUERY_RESERVE =
  20;
export const MAX_D1_BATCH_STATEMENTS = 50;
export const MAX_D1_AUDIT_ENTRIES = 16;
export const MAX_D1_AUDIT_PAYLOAD_BYTES =
  240_000;
export const MAX_CANONICAL_PLAN_BYTES =
  1_500_000;
export const LEGACY_IMPORT_LEASE_SECONDS =
  5 * 60;

// D1 bind上限100未満を維持
export const MAX_IN_CLAUSE = 80;

export const PARSER_VERSION = "3";
export const SCHEMA_VERSION = "1";
