export const MAX_IMPORT_FILES = 12;
export const MAX_IMPORT_TOTAL_BYTES = 6 * 1024 * 1024;
export const MAX_PREVIEW_ROWS = 100;
/** 一回の finalize は D1 batch の安全な固定上限に収める。 */
export const MAX_D1_BATCH_STATEMENTS = 50;
/** audit INSERT の bindings / SQL 長を越えないための保守的な上限。 */
export const MAX_D1_AUDIT_ENTRIES = 16;
export const MAX_D1_AUDIT_PAYLOAD_BYTES = 120_000;
/** canonical plan を一行へ保存する上限。巨大入力は preview 時点で拒否する。 */
export const MAX_CANONICAL_PLAN_BYTES = 300_000;
export const LEGACY_IMPORT_LEASE_SECONDS = 5 * 60;
export const MAX_IN_CLAUSE = 32;
export const PARSER_VERSION = "2";
export const SCHEMA_VERSION = "1";
