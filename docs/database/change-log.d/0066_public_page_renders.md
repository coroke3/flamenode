## 2026-10-18 — `0066_public_page_renders.sql`

| 項目 | 内容 |
| --- | --- |
| Type | additive |
| Summary | 個別ページ（作品・ユーザー・イベント）のQueue駆動R2事前生成要求を管理する `public_page_renders` テーブルと未処理行の部分 index `public_page_renders_pending_idx` を追加（MIG-0411） |
| Reason | ISR相当の個別ページHTML生成を1件ずつ有界CPU（max < 8ms）でQueue処理し、R2 HTMLへ事前配置するため |
| Tables | `public_page_renders` |
| Data migration | なし |
| Compatibility | 新規独立テーブル追加のみ。既存クエリ・公開DTO・権限への影響なし |
| Data loss | none |
| Rollback | `DROP TABLE IF EXISTS public_page_renders` |
| Validation | `check:db-schema`、`check:db-history`、`apps/site/src/gateway/pageRenderQueue.test.mjs` |
