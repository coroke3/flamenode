# FlameNode AI作業コンテキスト

> Status: Active
> Last verified: 2026-07-20
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
5. 本格運用前のため、旧形式互換を追加せず正本へ直接統一する。

同じ内容を複数文書から集めない。巨大な`source/`、`archive/`、完了済みphase資料を一括読込しない。

## 3. タスク別読取表

| タスク | 最初に読む | 次に確認する正本 |
| --- | --- | --- |
| 一般実装・不具合修正 | `AGENTS.md`、対象ファイル | 関連test、`package.json` |
| DB・migration | `docs/database/README.md`、`docs/operations/migrations.md` | `src/lib/db/schema.ts`、`migrations/`、`docs/database/change-log.md` |
| 認証・権限・owner | `AGENTS.md`、関連Active運用文書 | `src/lib/auth/`、権限判定コード、関連integration test |
| 公開API・DTO | `AGENTS.md` | Route Handler、公開payload builder、漏洩test |
| Worker・Cron・外部API | `docs/operations/workers.md` | `workers/`、各`wrangler.toml`、worker test |
| YouTube同期 | `docs/operations/youtube-playlist-sync.md` | 同期Worker、quota管理コード、関連migration |
| UI・フォーム | `docs/operations/ui-acceptance.md` | 対象page/component、CSS、関連test |
| 監査・復元 | `docs/operations/audit-and-restore.md` | mutation、audit helper、復元test |
| ローカル起動 | `LOCAL.md` | `package.json`、`.dev.vars.example` |
| デプロイ | `DEPLOY.md` | `.github/workflows/deploy-cloudflare.yml`、wrangler群 |
| 過去仕様の調査 | `docs/historical/README.md` | 必要な資料1件だけ |

## 4. 不変条件

- DB正本は`src/lib/db/schema.ts`。既適用migration本文を変更しない。
- Active codeへ旧列fallback、旧形式パーサー、二重書込み、runtime DDLを戻さない。
- 本格運用前は後方互換を実装せず、データとコードを正本へ一括移行する。
- 旧データが必要な場合は常設APIではなく、レビュー可能な一度限りのmigrationで変換する。
- `event_staff.permission_preset = 'owner'`をイベント代表者の正本とし、ownerを0人にしない。
- 権限はUIだけでなくServer ActionまたはRoute Handlerで検証する。
- 公開APIは明示したDTOだけを返し、内部情報を漏らさない。
- Cloudflare Pages + `@cloudflare/next-on-pages`、D1、R2、KV、Cron Worker 3本を維持する。
- 実Cloudflare操作、Remote D1操作、production secret操作は明示依頼時だけ行う。

## 5. モデル選択

- 軽量モデル（Luna、Haiku等）: 検索、一覧化、単純置換、限定的な文書修正、テスト結果整理
- 中位モデル: 境界が明確な通常実装、局所的なリファクタ
- 上位モデル: DB、認証・認可、security、公開API、破壊的変更、仕様衝突、最終レビュー

軽量モデルは、正本が1つに定まらない場合や変更が複数領域へ波及する場合、実装を断定せず上位モデルへ引き上げる。

## 6. 変更手順

1. 対象と非対象を決める。
2. 旧形式互換、重複経路、廃止予定コードを先に特定する。
3. 正本へ直接統一し、不要コードとテストを同時に削除する。
4. Active文書だけを必要に応じて更新する。
5. 変更種別に必要な検査を実行する。
6. 変更、検査結果、未実行理由、残課題を簡潔に報告する。

## 7. 検査の選び方

- Markdownのみ: `npm run check:docs`、`npm run check:project-docs`
- TypeScript/UI: `npm run typecheck`、`npm run lint`、関連test、`npm run build`
- Worker: 上記に加えて`npm run test:workers`
- DB/権限/API: 上記に加えて関連checkとintegration test
- release影響: `npm run pages:build`とCloudflare関連check

全検査一覧が必要な場合だけ`AGENTS.md`を参照する。
