## 2026-10-17 — `0065_public_build_state.sql`

| 項目 | 内容 |
| --- | --- |
| Type | additive |
| Summary | 公開データ再構築要求とデプロイフック発火状態を追跡する `public_build_state` テーブルを追加（MIG-0410） |
| Reason | Cloudflare Workers Builds Free上限（3,000分/月、1並列、max 20分）内で有界にデプロイフックをトリガーするため |
| Tables | `public_build_state` |
| Data migration | `INSERT INTO public_build_state (id) VALUES (1);` 初期行作成 |
| Compatibility | 新規独立テーブル追加のみ。既存クエリ・公開DTO・権限への影響なし |
| Data loss | none |
| Rollback | `DROP TABLE IF EXISTS public_build_state` |
| Validation | `check:db-schema`、`check:db-history`、`workers/fast-jobs/publicBuildTrigger.test.mjs` |
