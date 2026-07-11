-- 初回オンボーディング完了時刻 (Unix epoch 秒)
ALTER TABLE user ADD COLUMN onboarding_completed_at INTEGER;
