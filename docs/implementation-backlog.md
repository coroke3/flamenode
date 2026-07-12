# FlameNode 実装状況と残制約

> Status: Planned
> Last verified: 2026-07-12
> Verified against commit: `00be565` + working tree
> Source of truth: `src/lib/db/schema.ts`, `migrations/0000_flame_node_baseline.sql`, `docs/operations/README.md`

## 統合実装の完了状況

01〜07 統合仕様で要求されたコード上の整理は完了している。D1 を唯一の正本とし、R2 / KV の静的 JSON は再生成可能な配信キャッシュとして扱う。

| 領域 | 現行実装 | 状態 |
|---|---|---|
| 最終 schema / ID | `schema.ts` と baseline を一致させ、内部 `user_id`、Discord `discord_id`、X `x_user_id` を分離 | 完了 |
| event owner / 権限 | `permission_preset='owner'` を代表者の正本とし、最後の owner の削除・降格を service 層で防止 | 完了 |
| 原子性 / 監査 | 条件付き SQL と D1 batch により mutation・完全な before/after・監査ログを一括確定 | 完了 |
| 監査復元 | 復元可能性判定、直前競合検証、復元本体・復元履歴・RESTORE監査の一括確定 | 完了 |
| import / spreadsheet | preview token、lease、件数上限、canonical table への一括適用を実装 | 完了 |
| 公開範囲 / 静的配信 | 公開判定と whitelist DTO を共通化し、R2 優先・D1 正本・再生成 queue を実装 | 完了 |
| Worker | `fast-jobs` / `content-jobs` / `sync-jobs` の3本へ統合し、lock、lease、有限 retry、cleanup を実装 | 完了 |
| Cloudflare Pages / CI | `@cloudflare/next-on-pages`、secret 不要の PR build、成果物検査、fixture 検査、手動 production deploy workflow を実装 | 完了 |
| UI / responsive | 2カードの `/entry`、ライム accent、light/dark/system、ConsoleShell、モバイル drawer、Shelf、動画詳細のモバイル順を実装 | 完了 |
| 文書 / 履歴 | Active / Planned / Historical、DB change history、migration / deploy / incident 手順と CI 検査を整備 | 完了 |

## 削除・置換済みの旧実装

次の要素は最終 schema と runtime write path から除去済みであり、移行予定としては扱わない。

| 旧要素 | 現行の正本 |
|---|---|
| `api_endpoints` | `events.public_api_enabled` と公開 DTO 層 |
| `video_stats` | `videos.score` / `videos.app_like_count` / `video_youtube_metadata.view_count` |
| `event_staff.permission_mask` / `event_staff_permissions` | `permission_preset` / `custom_permission_keys_json` |
| `events.is_active` / `is_entry_open` / `is_archived` | `visibility_status` と受付期間から導出 |
| `system_settings.cost_guard_mode` / `is_maintenance_mode` | `operation_mode` |
| `events.custom_questions` / `videos.custom_answers` / `videos.stage_permission` | `event_custom_questions` / `video_custom_answers` |
| `videos.used_software_json` | `video_softwares` / `software_catalog` |
| `video_chapters.marker_kind` / `video_member_id` | chapter 行と `video_members.chapters_json` の明確な役割分離 |
| request-time DDL / 起動時 schema 適用 | 事前の手動 baseline 適用と schema 不一致時の fail-fast |

旧入力名は preview 表示や import 正規化の入口でのみ解釈し、旧 DB 列への読み書きや二重書き込みには使用しない。静的検査は `check:db-legacy` が runtime への再混入を拒否する。

## 実環境でのみ必要な作業

これらはコードの未実装ではなく、運用者の権限と実 resource が必要な手動工程である。

1. Remote D1 をバックアップし、`docs/operations/migrations.md` に従って baseline を明示適用する。
2. Cloudflare Pages、D1、R2、KV、3 Worker の resource ID と production secret を Environment に登録する。
3. Discord Developer Portal の callback URL と OAuth credential を設定する。
4. 手動 deploy workflow を実行し、Pages、静的 asset、Auth callback、任意の Worker health URL を smoke test する。

Remote D1 migration、resource 作成、実デプロイはこのリポジトリの自動検証では実行しない。

## 技術的に残る制約

- D1 は一般的な対話型 transaction API を前提にせず、正式な batch と条件付き SQL の範囲で all-or-nothing を保証する。大規模 import は Cloudflare の statement / parameter 制限に合わせて事前に拒否する。
- 監査 payload が上限を超える操作や、安全な逆操作を構成できない対象は復元可能に見せず、理由付き `not_restorable` とする。
- R2 / KV は配信キャッシュのため、更新直後に再生成待ちの短い遅延があり得る。整合性判断と repair の正本は常に D1 とする。
- OAuth、Cloudflare binding、実ドメイン、外部 API の到達性は、credential のない PR CI では確認できない。fixture 検査と production の fail-closed 検査を分離している。
- `@cloudflare/next-on-pages` 1.13.16 の peer dependency 上限は Next.js 15.5.2 である。Pages 固定条件を維持したまま Next.js を 15.5.16 以上へ上げられないため、Next.js 15.5.16 未満を対象とする high / critical の依存監査警告は残る。
- Wrangler 4.110 への更新は Node.js 22 と `@cloudflare/workers-types` の同時更新を要する。Pages / 3 Worker の dry-run と型検証を伴う独立した small-batch として実施する。

## 統合完了を妨げない将来拡張

- 任意の `select` / `radio` / `checkbox` カスタム質問を EventForm から新規定義する管理 UI は、正規化 schema と import 対応後のプロダクト拡張として扱う。
- `/recommend`、`/user` index、`/event/[id]/slots` を専用 static artifact へ広げる場合も、D1 正本と共通公開判定を維持する。

これらを未実装の統合要件や「次の PR で必須」の項目としては扱わない。追加する場合は新しい要求と検証条件を定義する。
