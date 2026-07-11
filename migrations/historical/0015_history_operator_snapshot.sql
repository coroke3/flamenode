-- 監査ログに actor のスナップショット情報を保存できるようにする。
-- Discord/X 側のユーザー名・アイコンが後から変わっても、当時のオペレーターを表示できる。
ALTER TABLE history_logs ADD COLUMN operator_snapshot_json TEXT;
