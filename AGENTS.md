# AGENTS.md

> Status: Active
> Last verified: 2026-10-06
> Verified against commit: `99591f7b3387b6b33d113f2685d6b31e38085fdc`
> Source of truth: 現行コード・test、`src/lib/db/schema.ts`、`migrations/`、`wrangler.toml`、`workers/*/wrangler.toml`
> Migration source of truth: [`docs/migration/README.md`](docs/migration/README.md)

## 開始（これだけ）

1. この文書を読む。
2. [`docs/AI_CONTEXT.md`](docs/AI_CONTEXT.md) の **該当タスク行だけ** を読む。
3. 対象コードと関連 test を直接読む。
4. **新基盤移行・UI再設計に関係する作業だけ** `docs/migration/README.md` を読む。

禁止:
- リポジトリ全体の一括読込
- `.claude/flamenode/source/`、`archive/`、完了済み phase、Historical の一括読込
- 移行と無関係な作業で migration 文書を持ち込むこと
- 「移行後ターゲット」を「現在productionで稼働中の構成」と誤認すること

## 矛盾時の優先順位

1. 現行コード・設定・test
2. `src/lib/db/schema.ts` と `migrations/`
3. Status が `Active` の文書
4. **移行対象についてのみ** `docs/migration/README.md`
5. `設計/`、`docs/design-redesign/` の現行提案
6. Historical / archive / 旧監査（経緯のみ。現行根拠にしない）

移行中は「現行production」と「target architecture」が同時に存在する。
どちらを指しているか不明なまま実装しない。

## 正本リンク

| 領域 | 正本 |
| --- | --- |
| DB構造 | `src/lib/db/schema.ts` |
| migration | `migrations/` |
| DB履歴 | `docs/database/change-log.md` |
| 現行binding | `wrangler.toml`, `workers/*/wrangler.toml` |
| 移行仕様 | `docs/migration/README.md` |
| 移行進捗 | `docs/migration/STATUS.md` |
| UI再設計 | `docs/design-redesign/README.md` とその参照順 |
| executable UI inventory | `app/(redesign)/dev/redesign/_catalog.ts` |
| ローカル | `LOCAL.md` |
| デプロイ | `DEPLOY.md` |
| 運用入口 | `docs/operations/README.md` |
| タスク導線 | `docs/AI_CONTEXT.md` |
| 未完了 | `docs/implementation-backlog.md` |

## 不変条件

### 全作業

- 既適用 migration の SQL 本文を変更しない。
- schema 列一覧を Markdown へ複製しない。
- 旧列 fallback、二重書込み、runtime DDL、deprecated wrapper を Active code へ戻さない。
- `event_staff.permission_preset = 'owner'` が代表者正本。owner を 0 人にしない。
- 権限はUIだけでなくserver境界で検証する。
- 公開APIは明示DTOだけを返す。
- Remote D1 のdeploy前検査はread-only。migrationを自動適用しない。
- 実Cloudflare deploy、Remote D1、production secret、Worker Route / Custom Domain変更は **明示依頼時だけ**。
- main直pushは禁止。通常はbranch + PR + required reviewを維持する。

### 移行中に必ず維持するもの

- D1を正本とする。
- 既存のR2 static artifact、Queue、visibility fence、audit、権限モデルを「書き直すためだけ」に置換しない。
- public→non-public のvisibility fenceはfail-closedを維持する。
- 公開停止の即時性を、SSG反映待ちへ退化させない。
- 認証移行はUI/API移行と分離する。既存Auth.js/NextAuth互換が証明されるまでproduction authを置換しない。
- 新Publicはrequest-time SSRを原則禁止する。
- 重い生成・集計・index生成をHTTP requestへ戻さない。
- 旧Next/OpenNextはroute parity・rollback・auth parityが確認されるまで削除しない。
- UI再設計で機能・権限・API副作用を意図せず削減しない。
- 「技術を変えること」を目的にしない。既存実装を残す方が安全なら残す。

## 現行productionとtarget architecture

### 現行production

現時点のproductionは Next.js + OpenNext + Cloudflare Workers Static Assets を中心とする。
`flamenode.net` / `www.flamenode.net` は現行 `flamenode-web` Custom Domainで稼働する。

### Target

移行後ターゲットは `docs/migration/README.md` を正本とする。

要約:

- Public: Astro SSG + React Islands
- Public request: thin visibility gateway + Static Assets
- Private UI: React + Vite SPA
- API: Hono
- Data: D1 authoritative / R2 projection / Queue generation
- Jobs: 既存 fast/content/sync Workersを原則維持
- Same domain: Worker Routesで責務別Workerへ分割
- SSR: default禁止、必要性を証明した例外のみ

この要約を根拠に細部を推測しない。詳細はmigration文書を確認する。

## 移行作業の基本順序

1. 現行挙動とtestを固定する。
2. framework-neutralなdomain service / contractを抽出する。
3. shared design systemを作る。
4. 新Public / API / SPAをshadowまたは限定routeで実装する。
5. parity / CPU / visibility / auth / UI acceptanceを検証する。
6. Worker Routeで限定的に切り替える。
7. 問題があればrouteを旧Nextへ戻す。
8. 全routeのparity確認後にのみOpenNext依存を削除する。

Big Bang rewriteは禁止。

## `/flamenode-migration` と `/loop`

移行タスクの標準入口は `.claude/commands/flamenode-migration.md`。

- `/flamenode-migration` は `docs/migration/STATUS.md` から現在Phaseと次のREADYタスクを選び、**1タスクだけ**実装する。
- `/loop` と併用する場合も1 iteration = 1 migration taskを守る。
- 各iterationの最後に `docs/migration/STATUS.md` を更新し、完了タスク・検査・残課題・次READYを明示する。
- STATUSが不整合、BLOCKED、または次READYが無い場合は実装を止め、進捗整理だけ行う。
- `/loop` から複数Phaseを跨いで自動実装しない。Phase GateはLeadが確認する。

## 作業規則

- 依頼を1文で固定し、対象と非対象を先に決める。
- 読むActive文書は原則3件以内。
- migration taskでは `AGENTS.md` + `docs/AI_CONTEXT.md`該当行 + `docs/migration/README.md` を基本セットとする。
- 同一情報を複数文書から集めない。
- 同一ファイルを複数エージェントへ同時編集させない。
- DB・認証・security・visibility・公開API・破壊的変更・共有型・Cloudflare routingの最終判断はLead。
- サブエージェントの差分とtest結果はLeadが再確認する。
- 推測でroute、binding、schema、権限を作らない。コード/設定を確認する。
- 移行中のcompatibility layerは期限と削除条件を明記する。
- 新しい独自framework / router / cache / island runtimeを作らない。

## バイブコーディング向け境界

AIが迷わないよう責務を固定する。

- `apps/site`: Public SSG / Astro / public React Islands
- `apps/app`: authenticated/private React SPA
- `apps/api`: Hono HTTP boundary
- `packages/ui`: framework-neutral React UI
- `packages/domain`: business logic。Next/Hono/Astro import禁止
- `packages/contracts`: Zod / shared API contract
- `packages/db`: schema / DB access
- `packages/public-data`: public projection DTO / loader contract
- `workers/*`: background / queue / scheduled jobs

移行途中で実ディレクトリがまだ存在しない場合、勝手に全コードを移動しない。
phaseごとの対象だけ追加する。

## モデル選択と停止

| 帯 | 用途 |
| --- | --- |
| 軽量 | 検索、一覧、単純置換、限定的文書修正、fixture作業、test結果整理 |
| 中位 | 境界が明確なUI/API移植、局所リファクタ、component実装 |
| 上位 | architecture、DB、auth、security、visibility、Cloudflare routing、破壊的変更、移行gate、最終レビュー |

軽量モデルは次の場合、実装せず上位へ上げる。

- 現行productionかtargetか判断できない
- 3領域以上へ波及する
- migration、権限、visibility、auth、データ削除を含む
- Worker Route / Custom Domain / production binding変更が必要
- 既存testと移行仕様が衝突する
- fallback / rollback条件が決められない

## 検査

変更種別に必要なものだけ実行する。未実行は理由を書く。

```sh
npm run typecheck
npm run lint
npm run test:unit
npm run test:workers
npm run test:integration
npm run verify:fast
npm run verify:full
npm run check:docs
npm run check:project-docs
npm run check:db-schema
npm run check:db-legacy
npm run check:public-api-contract
```

移行用に新しい検査scriptを追加する場合は、migration文書のAcceptance Gatesと対応付ける。

## 完了報告

以下だけを短く報告する。

- 変更内容
- 現行から維持した挙動
- target architecture上の到達点
- 実行した検査と結果
- 未実行と理由
- rollback可否
- 残課題
