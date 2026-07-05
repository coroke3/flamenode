# 監査ログ・復元設計 (audit_logs)

## 概要

FlameNode の監査ログ正本は `audit_logs` テーブル。旧 `history_logs` は互換用に残すが、新規書き込みは `writeAuditLog` / `auditAction` 経由のみ。

Cloudflare D1 Free 枠を前提に、**全件永久保存・巨大 JSON・全表スキャン**を禁止する。

## ログ分類 (retention_class)

| 分類 | 目的 | デフォルト保持 | 復元 |
|------|------|----------------|------|
| `normal` | 表示・追跡のみ | 30日 | 不可 |
| `restorable` | 重要操作の復元 | 180日 | 可能 (adapter 対応時) |
| `long_audit` | 証跡・削除・権限変更 | 365日 | 状況による |

設定は `/admin/audit/settings` から変更。`audit_log_settings` (id=`default`) が正本。

## テーブル

- `audit_logs` — 監査ログ本体
- `audit_restore_runs` — 復元実行履歴
- `audit_log_settings` — 保持日数・payload 上限など
- `history_logs` — **非推奨** (読み取り互換のみ)

マイグレーション: `migrations/0043_audit_logs.sql`

## 共通ロガー

```
src/lib/audit/
  types.ts      — 型・enum
  snapshot.ts   — サニタイズ・差分・payload 計算
  retention.ts  — expires_at・日数クランプ
  actor.ts      — 実行者スナップショット
  logger.ts     — writeAuditLog
  helpers.ts    — auditAction (旧 historyLogs 互換)
  adapters.ts   — テーブル別復元
  restore.ts    — restoreAuditLog
  settings.ts   — 設定取得・更新
```

### writeAuditLog の挙動

1. `audit_log_settings` を読み込み
2. actor snapshot を必ず保存
3. before/after をサニタイズ (機密キー redact、大文字列 truncate)
4. `max_payload_bytes` 超過 → `restore_status=not_restorable`、payload 要約のみ
5. `restore_strategy != none` かつ payload OK → `restorable`
6. `expires_at` を retention_class から計算
7. `strict: true` のとき INSERT 失敗で本体処理も失敗

### strict の目安

- 管理操作・権限・削除・long_audit → `strict: true`
- 通知・自動同期 → `strict: false` (本体継続可)

## 復元

### 復元できるもの (アプリ DB のみ)

ホワイトリスト adapter 実装済み:

- `events`
- `videos`
- `slots`
- `announcements`
- `event_groups`
- `x_account_link_requests`

戦略:

| strategy | 用途 |
|----------|------|
| `update_before` | UPDATE を before に戻す |
| `delete_created` | CREATE を取り消し (events/videos は archived) |
| `recreate_deleted` | DELETE を before から復元 |
| `custom_adapter` | X ID merge 等 (未実装は dry-run のみ) |

### 復元しないもの

- `account` / `session` / `verificationToken`
- `notification_outbox` / cost 系 / キャッシュ
- 外部 API 同期結果のみのテーブル

### 復元しない外部状態

YouTube 公開状態、Discord 通知送信済み、Auth セッション、R2 削除済みファイルなど。

UI に「アプリ DB 上の状態のみ復元」と明記。

### 競合チェック

ログ作成時の `after_json` と現行レコードを比較。不一致時はデフォルト `blocked`。管理者が `force_overwrite` を明示した場合のみ上書き復元。

### 復元操作の安全装置

- admin 限定
- 理由入力必須
- 確認文字列 `RESTORE {audit_id}` 必須
- 復元自体を `operation=RESTORE` で audit_logs に記録

## 管理 UI

| パス | 機能 |
|------|------|
| `/admin/audit` | 一覧 (デフォルト50件、最大100件) |
| `/admin/audit/[id]` | 詳細・dry-run・復元 |
| `/admin/audit/settings` | 保持日数設定 |
| `/admin/audit/restore` | 復元実行履歴 |

## cleanup Worker

`workers/cleanup/index.ts`:

1. `expires_at < now` の audit_logs を **最大500件/回** 削除
2. 期限切れ前に `restorable` → `expired` へ更新
3. `compact_after_days` 経過ログの before/after を NULL 化 (復元不可化)
4. 旧 `history_logs` も従来 TTL で削除 (互換)

## Cloudflare Free 制約

- 1操作1 audit insert (一括は `group_id` でまとめる設計余地あり)
- 検索は index + limit 必須
- console.log に巨大 JSON を出さない
- D1 Time Travel に依存しない

## 今後の拡張

優先 adapter 追加候補:

1. `event_staff` / `event_staff_permissions`
2. `video_members` / `video_chapters`
3. X ID merge — **長期監査 + dry-run のみ** (完全復元は専用 adapter 後)
