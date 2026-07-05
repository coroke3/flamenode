# 旧データ移行ツール 実装完了メモ

## 概要

`src/lib/legacy/` の旧モジュール群を `src/lib/import/legacy/` に移行し、DB canonical ルールへの完全準拠を達成。

## 変更内容

### 新モジュール (`src/lib/import/legacy/`)

| ファイル | 役割 |
|---|---|
| `constants.ts` | 上限値・バージョン定数 |
| `featureFlag.ts` | `ENABLE_LEGACY_IMPORT_TOOL` 環境変数フラグ |
| `types.ts` | カノニカル型定義 (`CanonicalEvent`, `CanonicalVideo` 等) |
| `importMode.ts` | `resolveImportedVisibility()` — `visibility_status` のみ返す |
| `normalizeCore.ts` | CSV/JSON パース・検出ロジック |
| `normalize.ts` | 旧データ → カノニカル変換 |
| `payload.ts` | `splitLegacyPayload()` |
| `plan.ts` | `buildLegacyImportPlan()` — プラン組立 |
| `hash.ts` | `stableSha256()` |
| `previewToken.ts` | `buildPreviewToken()` — dry-run 確認トークン |
| `dryRun.ts` | `buildDryRunResult()` — DB 未書き込みプレビュー |
| `apply.ts` | `applyLegacyImportPlan()` — 実際の DB 書き込み |
| `index.ts` | 全エクスポート |

### API

- `app/api/admin/import/legacy/route.ts` — 新エンドポイント (feature flag ゲート)
- `app/api/admin/legacy-import/route.ts` — 410 Gone レスポンスに置き換え

### DB canonical ルール準拠

- `events`: `visibility_status` のみ。`is_active`/`is_entry_open`/`is_archived` 非使用
- `videos`: `video_softwares` テーブル使用。`used_software_json`/`stage_permission` 列非使用
- `event_staff`: `permission_preset` のみ。`permission_mask` 非使用
- `x_users`: `approval_status = "imported"` で区別
- カスタム質問: `event_custom_questions` + `video_custom_answers` テーブル

### 取り込みストラテジー

| 値 | 動作 |
|---|---|
| `skip_existing` | 既存 ID は全スキップ (デフォルト) |
| `create_only` | 新規 ID のみ登録、既存は触れない |
| `replace_imported` | `approval_status=imported` の既存レコードを上書き |

### migration

`migrations/0048_legacy_import_batches.sql` — `legacy_import_batches` / `legacy_import_batch_items` テーブル追加。
`instrumentation.ts` で冪等 apply 済み。
