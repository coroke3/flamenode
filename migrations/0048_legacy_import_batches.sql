-- 0048: 旧データ移行ツール用 batch 管理テーブル（本格運用前の一回限り移行用）。
-- 後方互換なし。

CREATE TABLE IF NOT EXISTS legacy_import_batches (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL,
  file_count INTEGER NOT NULL,
  file_names_json TEXT,
  file_hash TEXT NOT NULL,
  plan_hash TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  strategy_json TEXT NOT NULL,
  counts_json TEXT,
  warning_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  executed_by_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  applied_at INTEGER,
  failed_at INTEGER,
  error_summary TEXT
);

CREATE INDEX IF NOT EXISTS legacy_import_batches_created_idx
  ON legacy_import_batches (created_at DESC);

CREATE INDEX IF NOT EXISTS legacy_import_batches_file_hash_idx
  ON legacy_import_batches (file_hash);

CREATE TABLE IF NOT EXISTS legacy_import_batch_items (
  batch_id TEXT NOT NULL,
  target_table TEXT NOT NULL,
  target_id TEXT NOT NULL,
  action TEXT NOT NULL,
  source_key TEXT,
  status TEXT NOT NULL,
  warning_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (batch_id, target_table, target_id)
);

CREATE INDEX IF NOT EXISTS legacy_import_batch_items_target_idx
  ON legacy_import_batch_items (target_table, target_id);
