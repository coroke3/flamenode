# FlameNode AI作業コンテキスト

> Status: Active
> Last verified: 2026-07-23
> Verified against commit: `630244ce`
> Source of truth: `AGENTS.md`, `src/lib/db/schema.ts`, `migrations/`, `package.json`, `wrangler.toml`

軽量モデルを含むAIは、リポジトリ全体を先に読まない。`AGENTS.md`と、この文書の該当行だけを読み、次に対象コードを確認する。

## 1. 情報の優先順位

矛盾時は上から優先する。

1. 実行中のコード、設定、テスト
2. `src/lib/db/schema.ts`と`migrations/`
3. Statusが`Active`の運用文書
4. `設計/`の現行設計
5. Historical、archive、旧監査資料

Historical資料は経緯確認専用で、現行仕様の根拠にしない。

## 2. 最小読取ルール

1. 依頼を1文で言い換える。
2. 下表から読む文書を最大3件選ぶ。
3. 対象コードとテストを直接読む。
4. 推測で不足を埋めず、正本を確認する。
5. 変更範囲を最小化し、現行正本を維持する。

同じ内容を複数文書から集めない。巨大な`source/`、`archive/`、完了済みphase資料を一括読込しない。

## 3. タスク別読取表

| タスク | 最初に読む | 次に確認する正本 |
| --- | --- | --- |
| 一般実装・不具合修正 | `AGENTS.md`、対象ファイル | 関連test、`package.json` |
| DB・migration | `docs/database/README.md`、`docs/operations/migrations.md` | `src/lib/db/schema.ts`、`migrations/`、`docs/database/change-log.md` |
| DB正本移行・旧データ変換 | `docs/database/canonical-migration-plan.md` | `migrations/0043_db_canonical_migration.sql`、移行fixture、検証script |
| 認証・権限・owner | `AGENTS.md`、関連Active運用文書 | `src/lib/auth/`、権限判定コード、関連integration test |
| 公開API・DTO | `AGENTS.md` | Route Handler、`src/lib/api/publicDto.ts`、漏洩test |
| Worker・Cron・外部API | `docs/operations/workers.md` | `workers/`、各`wrangler.toml`、worker test |
| Worker・Queue | `docs/operations/workers.md` | `src/lib/queues/wakeBudget.ts`、`workers/*/wrangler.toml`、Queue関連test |
| YouTube同期 | `docs/operations/youtube-playlist-sync.md` | 同期Worker、quota管理コード、関連migration |
| UI・フォーム | `docs/operations/ui-acceptance.md` | 対象page/component、CSS、関連test |
| 公開静的配信・degraded D1 | `docs/operations/static-delivery.md` | `src/lib/publicData/loader.ts`、`degradedPolicy.ts` |
| 監査・復元 | `docs/operations/audit-and-restore.md` | mutation、audit helper、復元test |
| ローカル起動 | `LOCAL.md` | `package.json`、`.dev.vars.example` |
| デプロイ | `DEPLOY.md`、`docs/operations/deploy-setup-report.md` | `package.json`の`cf:*`、`scripts/cloudflare-*.mjs`、wrangler群 |
| 過去仕様の調査 | `docs/historical/README.md` | 必要な資料1件だけ |

旧形式インポートは通常ランタイムの互換機能ではない。保管済みの旧JSON、CSV、TSVを新正本へ一度だけ取り込む場合は、既存の管理者専用境界 `/admin/import`、`/api/admin/import/legacy`、`src/lib/import/legacy/` に限定する。通常ランタイム、公開API、Workerへ旧形式分岐を追加しない。

## 4. 不変条件

- DB正本は`src/lib/db/schema.ts`。既適用migration本文を変更しない。
- Active codeへ旧列fallback、二重書込み、runtime DDLを戻さない。
- 旧形式入力は `/admin/import`、`/api/admin/import/legacy`、`src/lib/import/legacy/` の管理者専用境界から広げず、別経路を再導入しない。
- `event_staff.permission_preset = 'owner'`をイベント代表者の正本とし、ownerを0人にしない。
- 権限はUIだけでなくServer ActionまたはRoute Handlerで検証する。
- 公開APIは明示したDTOだけを返し、内部情報を漏らさない。
- Cloudflare Workers + OpenNext + Workers Static Assets、D1、R2、KV、Queue 6本（wake 3 + DLQ 3）、Recovery Cron Worker 3本を維持する。
- productionはCloudflare Workers Buildsの単一Git連携だけを正本とし、GitHub ActionsやWorker別Git連携を追加しない。
- Remote D1 migrationは自動適用せず、read-only preflightと運用者の明示適用を分離する。
- 実Cloudflare操作、Remote D1操作、production secret操作は明示依頼時だけ行う。

## 5. モデル選択

- 軽量モデル（Luna、Haiku等）: 検索、一覧化、単純置換、限定的な文書修正、テスト結果整理
- 中位モデル: 境界が明確な通常実装、局所的なリファクタ
- 上位モデル: DB、認証・認可、security、公開API、破壊的変更、仕様衝突、最終レビュー

軽量モデルは、正本が1つに定まらない場合や変更が複数領域へ波及する場合、実装を断定せず上位モデルへ引き上げる。

## 6. 変更手順

1. 対象と非対象を決める。
2. 既存testから維持すべき現行挙動を確認する。
3. 最小差分で変更する。
4. Active文書だけを必要に応じて更新する。
5. 変更種別に必要な検査を実行する。
6. 変更、検査結果、未実行理由、残課題を簡潔に報告する。

## 7. 検査の選び方

- Markdownのみ: `npm run check:docs`、`npm run check:project-docs`
- TypeScript/UI: `npm run typecheck`、`npm run lint`、関連test、`npm run build`
- Worker: 上記に加えて`npm run test:workers`
- DB/権限/API: 上記に加えて関連checkとintegration test
- release影響: `npm run verify:fast`、`npm run cf:build`、`npm run check:open-next-output`とCloudflare関連check

全検査一覧が必要な場合だけ`AGENTS.md`を参照する。
