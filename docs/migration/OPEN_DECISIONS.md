# FlameNode Migration Open Decisions

> Status: Active / 人間（ユーザー）の判断待ち事項の正本
> Last updated: 2026-10-09
> 関連: [`STATUS.md`](STATUS.md), [`PRODUCT_REQUIREMENTS.md`](PRODUCT_REQUIREMENTS.md), [`ROUTING_AND_DEPLOY_PLAN.md`](ROUTING_AND_DEPLOY_PLAN.md)

エージェントが独断で確定してはいけない判断事項を一箇所に集める。
各 Decision は「判断が必要になるタスク」「推奨デフォルト」を持つ。
ユーザーが回答するまで、推奨デフォルトを**実装の前提にしてはいけない**（仕様書上の仮置きとしてのみ使う）。
回答後は `State` を `DECIDED` にし、決定内容を該当する仕様書へ反映してから削除せず履歴として残す。

## 実行時の判定

- `OPEN` / `PROVISIONAL` / `BLOCKED_ON_USER` は実装上の承認ではない。対象MIGを `READY` / `IN_PROGRESS` / `REVIEW` / `DONE` にする前に `DECIDED` が必要（純粋処理の限定scopeは別task・明示exceptionに分離）。
- `scripts/check-migration-execution.mjs` と `check:project-docs` によって最低限のtask/Decision整合を検証する。決定のowner、日時、採用方針、影響ファイル、実測/PoCの根拠をこの文書に残す。
- Decisionが必要なMIGを変更するときはvalidatorの `REQUIRED_DECISIONS` も更新する。OPENのままD-01等を仮採用して進行しない。

## 一覧

| ID | 判断事項 | State | 判断が必要になるタスク |
| --- | --- | --- | --- |
| D-01 | `packages/domain` が参照する DB schema の置き場所（循環依存の回避） | OPEN | MIG-0302 以降（DB に触るドメイン抽出すべて） |
| D-02 | 同一ホスト名での Worker Route と Custom Domain の優先関係と、段階切替の方式 | OPEN | MIG-0405（visibility gateway）の前。本番 Route 変更はすべて |
| D-03 | Active X 未所持・複数所持ユーザーの既存 like/bookmark の移行規則 | OPEN | Active X backfill（`ACTIVE_X_MIGRATION_PLAN.md` Step 2） |
| D-04 | 現行 Next.js と新 Worker が並走する期間の like/bookmark 書き込み主体 | OPEN | Active X Step 3（API 契約切替） |
| D-05 | Private SPA を 1 つにするか、プレフィックスごとに分けるか | PROVISIONAL | MIG-0701（Phase 7 開始前） |
| D-06 | 公開作品数・ユーザー数・イベント数の実数と Free 枠 Static Assets 上限の見通し | OPEN | MIG-0406（CPU/build benchmark）の前 |
| D-07 | Phase 8 の認証実装方針（Auth.js を Workers で継続利用するか） | PROVISIONAL | MIG-0802 |
| D-08 | Phase 2 の HTML モックの提供時期 | BLOCKED_ON_USER | MIG-0200（公開画面 Phase 4/5 の前提） |

`PROVISIONAL` は、仕様書が推奨デフォルトで進める前提を置いているが、ユーザー確認がまだ済んでいないもの。

## D-01 DB schema の置き場所

- 事実: DB schema の正本は `src/lib/db/schema.ts`（`schema.base.ts` / `schema.canonical.ts` を再 export）。
  `AGENTS.md` は schema の置き場所を正本として固定している。
- 問題: `packages/domain` が `src/lib/db/schema` を相対 import すると、`packages/*` → `src/*` の依存になる。
  一方、`src/lib/**` は `packages/domain` を呼ぶ互換ブリッジになるため、**循環依存**になる。
  また `packages/domain` の `tsconfig` / `package.json` は `src/` を含まない。
- 選択肢:
  - A. schema を `packages/db`（新設）へ移し、`src/lib/db/schema.ts` を再 export にする。
    drizzle の schema 正本パスが変わるため、`AGENTS.md` / `drizzle.config` / `check-db-schema` の更新が必要。
  - B. schema は `src/` のまま。`packages/domain` は DB を触らない純粋ロジック（`*Core.ts` 相当）だけを持ち、
    DB を触る orchestration は `src/lib/**` または `apps/api` 側に残す。
  - C. `packages/domain` が drizzle table 型を持たず、クエリ実行を domain 定義の port（interface）へ注入する。
- 推奨デフォルト: **B を先行**（MIG-0301〜0307 のうち DB 非依存部分は D-01 の回答なしに進められる）。
  A への移行は D-01 の回答後に独立した `MIG-*` タスクとして追加する。
- 影響: `PHASE_3_SPEC.md` は B を前提に、DB を触る抽出を「D-01 回答待ち」と明記している。

## D-02 同一ホストでの Route と Custom Domain

- 事実: [`cloudflare/TOPOLOGY.md`](cloudflare/TOPOLOGY.md) のとおり、本番は
  `flamenode.net` / `www.flamenode.net` が `flamenode-web` の **Custom Domain**、zone の Worker Route は 0 件。
- `README.md` §7 の設計は「path ごとの Worker Route で新 Worker へ振り、未一致は現行 Custom Domain へ」。
  しかし Cloudflare の説明では、Custom Domain は「Worker がそのホストの origin になる」もの、
  Route は「別の origin の前段で動く」ものであり、同一ホストへ両方を置いた場合の優先関係は
  この repo の調査では**実証されていない**。
- 選択肢:
  - A. PoC で「Custom Domain 上に path Route を重ねて新 Worker へ振れる」ことを実証する（非本番ホスト名で）。
  - B. 前段の薄い router Worker（service binding で web/site/app/api へ振る）を置き、現行 Custom Domain を router へ付け替える。
  - C. Custom Domain を外して zone Route 方式へ切り替える（DNS の proxied record が必要。切替時に短い断面リスクがある）。
- 推奨デフォルト: **A を非本番ホスト名で先に検証**し、不成立なら B。
  どの案でも本番の Route / Custom Domain 変更は `AGENTS.md` により**明示承認が必要**。
- 影響: Phase 5 以降のすべての本番切替手順。`ROUTING_AND_DEPLOY_PLAN.md` はこの未確定を前提に書かれている。

## D-03 Active X 未所持・複数所持ユーザーの既存 interaction

- 事実:
  - CURRENT の like/bookmark は `video_interactions_auth`（Auth User 単位）に保存される。
  - 旧 `video_interactions`（`x_user_id` 単位）も残っており、X ID merge の対象になっている。
  - `users.active_x_user_id` は null になり得る。複数の approved X を持つユーザーもいる。
- 決めること:
  1. 複数の approved X を持ち、`active_x_user_id` が null/無効なユーザーの既存データをどの X へ移すか。
  2. approved X を持たないユーザーのデータを、リンク完了まで `video_interactions_auth` に残してよいか（推奨: 残す。削除しない）。
  3. 1 つの Active X に複数 Auth User の like が集まって重複した場合、件数（`videos.app_like_count`）をどう扱うか（推奨: 重複を畳み、件数を再集計する）。
- 推奨デフォルト: 上記の括弧内。`ACTIVE_X_MIGRATION_PLAN.md` はこれを仮置きとして書いている。

## D-04 並走期間の書き込み主体

- Phase 6〜7 の間、Next.js の Server Action と Hono API が同じ D1 を書く。
  like/bookmark の書き込み先を切り替える瞬間に、どちらのパスも同じテーブルを更新する必要がある。
- 選択肢: A. feature flag（`system_settings`）で一括切替。B. 両テーブルへ書く期間を設ける（`AGENTS.md` の「uncontrolled dual write 禁止」に抵触しないよう、期間・解除条件・整合チェックを明記する）。
- 推奨デフォルト: **A（flag で一括切替。dual write はしない）**。切替前に backfill 完了と整合チェックを必須にする。

## D-05 Private SPA の構成

- 事実: `README.md` の route group 表は `/dashboard` `/entry` `/manage` `/admin` を同じ React/Vite app へ割り当てている。
- 仮置き: **SPA は 1 つ（`apps/app`）**。Vite の `base` は `/`、アセットは `/_app_assets/*`。
  Worker Route は `/dashboard/*`, `/entry/*`, `/manage/*`, `/admin/*`, `/onboarding` を app へ向ける。
  （`/auth/complete` と `/api/auth/*` は Phase 8 まで現行 Auth.js 側に残す。）
- 代替: `/admin` だけ別 bundle にする（admin 画面が 45 あり bundle が大きい）。Phase 7 開始前に bundle 実測で再判断する。

## D-06 公開データ規模と Free 枠

- 事実: Workers Static Assets の Free 上限は 1 version あたり 20,000 ファイル（Cloudflare 公式。移行時に最新値を再確認すること）。
  Astro は増分ビルドをせず、デプロイは毎回サイト全体になる。
- 不明: 本番の公開作品数・ユーザー数・イベント数。1 作品あたりの出力ファイル数（HTML + 付随ファイル）。
- 必要な回答: 本番の件数（read-only の COUNT で足りる。実行にはユーザー承認が必要）と、Paid プランへ移る可能性。
- 影響: MIG-0406 の benchmark 閾値、全件 SSG か「上位のみ SSG + 残りは別方式」か。
  「残りを request-time で生成する」案は `README.md` の「SSR は原則禁止」に反するため、採用するなら README の改定判断が要る。

## D-07 Phase 8 の認証方針

- 事実: CURRENT は Auth.js の **database session**（D1 の `session` テーブル）。Cookie は不透明トークン。
  `README.md` は「自前の auth protocol を新規実装しない」。
- 仮置き: 新 Worker（Hono）でも **Auth.js（`@auth/core`）と既存 D1 adapter を継続利用**し、同じ session テーブルと Cookie 名を読む。
  これならユーザーは再ログイン不要で、PKCE などを自前実装しない。
- 確認事項: 本番の Discord redirect URI（callback の origin）を変えるか。変えない前提（`flamenode.net` のまま）で進めてよいか。

## D-08 HTML モック

- `UI_REFERENCE.md = PENDING_HTML`。提供されるまで Phase 2 と、これに依存する Phase 4/5 は進めない。
- Phase 3（UI 非依存のドメイン抽出）は先行できる。
