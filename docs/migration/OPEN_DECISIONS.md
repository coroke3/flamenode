# FlameNode Migration Decisions — adopted options & remaining evidence

> Status: Active / 仕様上の採用方針と実行ゲートの正本
> Last updated: 2026-10-15
> Decision owner: user (2026-10-09, this conversation)
> Related: [STATUS.md](STATUS.md), [DB_PACKAGE_EXTRACTION_PLAN.md](DB_PACKAGE_EXTRACTION_PLAN.md), [ACTIVE_X_MIGRATION_PLAN.md](ACTIVE_X_MIGRATION_PLAN.md), [ROUTING_AND_DEPLOY_PLAN.md](ROUTING_AND_DEPLOY_PLAN.md), [PHASE_4_5_SPEC.md](PHASE_4_5_SPEC.md), [PHASE_7_SPEC.md](PHASE_7_SPEC.md)

## State semantics (agent MUST read)

`DECIDED` = **設計方針への合意**。PoC成功、実装完了、本番反映または運用承認を表さない。
`BLOCKED_ON_USER` = 方針は決まっていてもユーザーの成果物が未提供。
`PROVISIONAL` = 方針未確定。根拠未検証の決定を推測しない。
関係taskがREADYになるには **DECIDED + 必須evidence + task依存完了** が必要。status文字列だけではGateを通せない。
本番トラフィック/Worker Route/Custom Domain/Remote D1/認証/Secretsを変更するには作業直前の明示承認を別途必要とする。

| ID | 決定内容 | State | 適用タスク | 実装/切替前の別途条件 |
| --- | --- | --- | --- | --- |
| D-01 | **A: schemaを`packages/db`へ独立化** | DECIDED | MIG-0303..0307 | DB package移設PoC、schema diffゼロ、旧/新build pass |
| D-02 | **A: 既存Custom Domainの上に必要なpath Routeを重ねる** | DECIDED | MIG-0405, production route cutovers | 非本番のroot/www相当で実Ingress PoC成功 |
| D-03 | **承認済み・ownerリンクの全Xへ既存like/bookmarkをfan-out** | DECIDED | Active X backfill, MIG-0605/0702 | 共有Xの衝突/件数/無所有の照合とdry-run |
| D-04 | **A: feature flagで一斉cutover** | DECIDED | Active X Step 3, MIG-0702 | 全write route停止/final delta reconcile/逆戻し演習 |
| D-05 | **Personal(/dashboard,/entry) と Ops(/manage,/admin) の2 SPA** | DECIDED | MIG-0701..0706 | 独立build/asset prefix/deep links/権限確認 |
| D-06 | **A: 無料SSG優先。容量超過時はR2事前生成HTML優先、限定SSRは例外** | DECIDED | MIG-0406/0501..0508 | 静的出力実数・CPU・1102/visibility/SEO検証 |
| D-07 | **A: Workers環境でもAuth.js/@auth/coreを継続利用** | DECIDED | MIG-0802..0806 | cookie/session/CSRF/OAuth非本番互換PoC |
| D-08 | **A: HTMLモックを先に確定してからUIを移行** | DECIDED | MIG-0200..0206 / MIG-0402,0403 / Phase5 visual | デザインモック受領・登録完了（docs/migration/mock/、UI_REFERENCE.md）。Phase 2抽出アンロック。 |
| D-09 | **A: 一覧・検索などの公開データは build 時に作り、更新は deploy hook で build を起こす。作品・ユーザー・イベントの個別ページは ISR 相当（更新されたページだけを Queue で R2 HTML に作り直す、2026-10-16 改訂）。残る背景処理は 1回 8ms 未満に分ける** | DECIDED | MIG-0409, MIG-0410, MIG-0411, MIG-0509, MIG-0609, MIG-0610, MIG-0907。`ZERO_1102.md` G2 | build 時の D1 読み取り用 token と deploy hook URL（どちらも secret）の作成、本番の Cron / Queue 変更は作業直前の明示承認 |

## D-01 — DB schemaをpackages/dbへ独立（A）

現状の正本 `src/lib/db/schema.ts` は `schema.base.ts` と `schema.canonical.ts` を再export。canonicalからbaseを参照するため2ファイルだけの抜き出しは禁止。設計の唯一の正本は移設後の `packages/db/src/schema/*` とし、旧`src/lib/db/schema.ts` ほかを互換再exportに置き換える。詳しい順序・依存グラフ・ゼロDDL・検証条件は [DB_PACKAGE_EXTRACTION_PLAN.md](DB_PACKAGE_EXTRACTION_PLAN.md) を参照。

- `packages/db` は`drizzle-orm`等必要なruntime依存を明示し、Next/Honoをimportしない。root `src/**`へのimport禁止。
- `packages/domain` は`@flamenode/db`を参照可能。ただしSQL実行・D1 Binding取得・監査/Queue orchestrationはdomainへ安易に混ぜない。
- `drizzle.config.ts` と`check-db-schema` 等を変更し、生成したSQL/schema diffをゼロに保つ。**この決定はDB migrationの本番実行許可ではない**。
- 追加タスクは **MIG-0308**（MIG-0302後/MIG-0303前）のDB-package extraction専用MIGとして追跡し、他taskに密かに混ぜない。

## D-02 — Cloudflare ingressはA

Cloudflare公式仕様上、**同一hostnameのRouteがCustom Domainに優先し、Routeから`fetch(request)`でCustom DomainのWorkerへ委譲可能**。ただし実アカウントでのDNS/route命名、URLパターン衝突、根域/WWW/assetなどは非本番で証明する。

- 原則 path-level の明示的なWorker Routeを採用し、未移行pathは既存 `flamenode-web` Custom Domainに委譲する。
- CloudflareのRoute patternはglobであり `/:id` を文字どおり登録しない。root動画slugと固定パスの競合は薄いroute dispatcherのPoC/段階切替で決める。
- 非本番PoC要件: path match precedence, direct reload, assets, query/cookies, auth exclusion, fail-closed visibility, 404/403/redirect/cache, legacy fallback, root+www host parity, 1102/CPU。
- PoC不合格なら**自動的にRouter案Bへ変更しない**。差異を記録し、切替方式を再審議する。
- 本番Route/Custom Domain/DNS操作は別途人間承認。

## D-03 — 所有するすべてのXへのfan-out

現行 `video_interactions_auth` の各 (auth_user_id, video_id, type) を、そのAuth Userが**ownerとしてリンクしているすべての承認済みX**へ複製する。これは**既存データの移行ルール**であり、新UIでの将来のlike操作を全Xへ同時適用する決定ではない。

- 所有判定: `x_user_account_links.auth_user_id = Auth User`、`link_role='owner'`、`x_users.approval_status='approved'`。managerリンク、申請中、rejected、importedのみは対象外。`users.active_x_user_id`だけに限定しない。
- 0件のAuth User: 旧テーブルのinteractionを削除しない。承認済みownerリンクが後からできた時点で、本人への可視化/移行契約を履行。
- 同じXが複数Auth Userから届く: `(x_user_id, video_id, interaction_type)` を1行に畳む。元AuthとXの紐付け・source timestampを監査し、削除/解除の整合問題を隠さない。
- like count: **Auth単位ではなく承認済みX単位のdistinct件数**に再集計。fan-outにより数が増えることを許容するが、動画ごとの差分・上限/不正検知を行う。
- 元の`video_interactions`との衝突もdry-runに列挙し、timestampの採用・revocation競合を仕様化。コピーだけの`INSERT OR IGNORE`を完全移行とは扱わない。
- 詳細は [ACTIVE_X_MIGRATION_PLAN.md](ACTIVE_X_MIGRATION_PLAN.md)。本番データ書込・実データの閲覧許可とは別。

## D-04 — 新旧cutoverは一気に行う（A）

**同じ切替窓で全like/bookmark read/write経路を一括変更**。利用者やfeatureごとの段階的dual writeは行わない。一気に切り替える対象はinteractionのみで、サイト全体のNext→Astro/Hono切替とは別。

1. 旧/新Workerの全書き込み入口を列挙し、旧ランタイムも同じflagを見て新Serviceへ委譲する互換shimを準備。
2. 非本番全ケース移行/rollback演習。初回snapshot→dry-run fan-out→(差分journal または厳密なwrite freeze)。
3. 書き込み停止（全入口でfail-closed、Queue再試行含む）→final delta適用→件数/ownership/重複チェック→single feature flag切替→両経路E2E。
4. 失敗時はwrite freeze維持、復元できる差分のみreconcile。**新側更新後のflag単純rollbackは禁止**。
5. 旧テーブル廃止は後続Phase 9 Gateの別作業。本番切替・Remote D1は承認制。

## D-05 — 2つのPrivate SPAへ分割

- **Personal SPA**: `apps/app`（既存shellを継続、移行後の`flamenode-personal`）。`/dashboard`, `/dashboard/*`, `/entry`, `/entry/*`, `/onboarding`。
- **Ops SPA**: `apps/ops`（新設予定、`flamenode-ops`）。`/manage`, `/manage/*`, `/admin`, `/admin/*`。
- 双方`base: '/'`でブラウザの実URLを維持。互いに衝突しないアセット: `/_personal_assets/*` と `/_ops_assets/*`。各SPAの`assetsDir`に加え、公開prefix・manifest・worker/assets routingを契約検証する。
- `packages/ui`, `packages/contracts`, `packages/domain` は共有して重複させない。ただしOps限定コードはPersonalにbundlingしない。cross-SPA移動は通常HTTP navigation、ページ再読込でもセッション継続。
- `/dashboard/edit/*`はPersonal。roleによるOps遷移はUIだけでなくHonoでserver-side認可する。
- **まだ`apps/ops`は実在しない**。Phase 7で新設するまで旧Manage/Adminの本番振分先は`flamenode-web`のまま。

## D-06 — 無料SSG優先、1102を回避する予備経路

**2026-10-09追補:** 既存のD-06方針は維持。既存MIGの依存関係だけ整理し、MIG-0401→0404→0405→0406の**非visual PoC**をD-08入力なしで実行可能とする。D-08で要求した「UIを正式に移行する前のHTML確定」は変更しない。両証跡が0407 Gateの必須条件。詳細は[PERFORMANCE_IMPLEMENTATION_PLAN.md](PERFORMANCE_IMPLEMENTATION_PLAN.md)。

優先順: (1) Astro SSG + Static Assets、(2) 非同期/ビルド時にR2へ保存済みのHTMLを軽量Workerでstream/proxyして返却、(3) **実測合格した例外のみ**SSR。上限超過をSSR実行の自動許可と扱わない。

- Free Static Assets 20,000 files/version、Free CPU 10ms/request、1102=CPU/memory等のリソース超過。本番件数は未実測。
- `MIG-0406`にて公開URL+HTML+CSS/JS/fonts/redirect+manifest等をファイル実数で集計し、配信規模・build時間・Cloudflare quotasを測定。バッファを持たず20,000ぎりぎりで運用しない。
- R2 HTMLはcompile/offline snapshot generationで作り、content-hash + visibility-versionに紐づく。公開/非公開の境界はgatewayで常時fail-closed、古いHTMLが残っても漏洩させない。
- Cache miss時にCPU重いSSRへ暗黙fallbackしない。missing snapshotは安全な404/503/再生成enqueue。alias/OGP/canonical/hydrationとcache purgeは既存と同等に。
- 限定SSRを採用する前に実CloudflareのCPU分布(p50/p95/p99)、worst-case、memory、1102=0をshadow loadで確認。既定p99 < 5ms、hard limit 10msのFreeでは動的ページごとのCPU spikeがある限り安全を保証しない。合格しなければR2 cached HTML/SSGを維持する。
- 事前HTMLに使うR2のread課金/制限、Queue rebuild cost、stale許容度とCloudflare request quotaを別途測る。Paidへの変更は依頼なしに行わない。

## D-07 — Auth.js継続（A）

Hono/Workersで`@auth/core`と既存D1 adapter, `user/account/session`, cookie名/属性/期限、Discord providerと従来Callbackを維持。自前OAuth/PKCEを作らず、Account link atomicity・CSRF・logout・BAN・role・Active X・session refreshを旧Nextとの並走環境でテスト。

- 正規originは`https://flamenode.net`、既存Discord callback URLを原則変更しない。
- PoC合格まで`/api/auth/*`と`/auth/complete`は旧Nextへ。既存sessionの無強制ログアウトがGate。
- Auth cutoverは人間承認。PoC失敗時はNext Auth.js部分を保持して先に他のアプリのみ移す。

## D-08 — UIモックを先に確定（A）

ユーザー選択はA。**2026-10-13 確定:** ユーザーからデザインモック一式（claude.ai Design アーティファクト version 1791816999-f0e9、全96ページ・パーツ）を受領し、[`docs/migration/mock/`](mock/README.md) に配置・[`UI_REFERENCE.md`](UI_REFERENCE.md) に登録完了。D-08 は **DECIDED** となった。

- 受領・検証したモック（`docs/migration/mock/`）を公開新UIのビジュアル正本とする。採用済みOption A（公開UIだけ刷新、非公開UIはCURRENT再利用）を維持し、非公開モックは参考資料とする。非公開画面の刷新は別の明示決定を要する。
- Phase 2（MIG-0201: visual/IA抽出・tokens）は依存を満たして開始可能。Phase 4/5の公開UIとPhase 7の非公開SPAは各MIGの依存・Gateを要求する。登録は自動着手・本番切替の許可ではない。
- 移行中もCURRENTのUX/FN/API/権限/URL副作用を厳格に保持する（ビジュアルの反映のみで機能を暗黙削除しない）。

## Open evidence — separate from design decisions

- D-01: packages/dbの実移設、循環依存/生成migration diffゼロ検証。
- D-02: 非本番hostnameにおけるRoute+Custom Domain PoC。設定作成はユーザー承認後。
- D-03/04: dry-runでの実データ件数・所有者不明/共有X衝突・write-freeze/rollback演習。
- D-05: Apps/Workersの2SPA buildとdeep link/asset分離のE2E。
- D-06: 本番のREAD ONLY COUNT、Static Assets files、CPU/1102負荷測定。リモートデータ取得の承認が必要なら別途取得。
- D-07: 既存auth cookie/session/OAuth契約の非本番PoC。
- D-08: HTMLモックの受領・UI_REFERENCE.md登録完了（MIG-0200完了）。

## D-09 — 背景処理の 1102 ゼロ化（A、2026-10-15 決定）

ユーザーが 2026-10-15 の決定カードで A を選んだ。

根拠: 背景処理の Worker（`flamenode-content-jobs`、`flamenode-fast-jobs`、`flamenode-sync-jobs`）は、どの MIG task でも「触らない」になっていた。CURRENT の CPU は content の queue が p95 107ms・max 148ms、sync の scheduled が max 83ms（[cloudflare/PERFORMANCE_BASELINE.md](cloudflare/PERFORMANCE_BASELINE.md) の Four-Worker 表）。Workers Free の Cron Trigger の上限は 10ms（https://developers.cloudflare.com/workers/platform/limits/ ）。詳細は [ZERO_1102.md](ZERO_1102.md) §6。

| 案 | 内容 | 代償 |
| --- | --- | --- |
| **A（採用）** | 公開データ（一覧・検索索引・人気順など）の生成を Worker から build 時（Astro の build）へ移し、内容の更新は deploy hook で build を起こす。残る小さな処理（通知など）は B の方法で 8ms 未満に分ける | 作品の追加・修正が公開ページに出るまで、build 1回分以上かかる。build 回数に上限がある |
| B | 背景処理をすべて Worker のまま、1 message あたり 8ms 未満になるよう分割する | 検索索引の作成（CURRENT で 350ms〜1.6s）を数十〜数百の message に分ける必要があり、仕組みが複雑になる。Queue の無料枠（1日 10,000 operations）を圧迫する |
| C | Workers Paid（月 $5〜）にし、背景処理の CPU 上限を 30秒〜15分にする | 費用がかかる。web の request は Paid でも予算どおり 10ms 未満を守る |

### 2026-10-16 改訂: 個別ページは ISR 相当

ユーザーが 2026-10-16 の決定カードで「個別は ISR 相当」を選んだ。元の要件（[PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md) の「Astro SSG Build Trigger & Free Tier Budget」）と D-06 の②（R2 に保存した事前生成 HTML）に合わせる。

- 作品・ユーザー・イベントの個別ページは、更新のたびにそのページだけを Queue consumer が作り直して R2 に置き、gateway（S1）が返す（MIG-0411）。反映は数分以内。
- 条件: 1ページの生成が **max < 8ms**。Queue consumer も 10ms の上限として扱う（[ZERO_1102.md](ZERO_1102.md) §1 の本番実測）。MIG-0409 で測り、超えるページの種類は build（MIG-0410 の deploy hook）に回す。
- Next の ISR は再生成1回 16〜71ms だった（`docs/operations/workers.md`、ローカル計測）。React SSR を含むためで、Astro の1ページ生成（`experimental_AstroContainer.renderToString`、`node_modules/astro/dist/container/index.d.ts:227`、astro 5.18.2）は未計測。
- 一覧・検索索引・人気順など、多数の行から作るデータは build のまま（約 100分の遅れは下の制約のとおり）。

### A を実装するときの制約（出典付き）

- **build の上限（Workers Builds、Free）:** build 時間は月 3,000 分、同時 1、1回 20分まで。Deploy Hook は Worker ごとに 10回/分。出典: https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/
- **Deploy Hook:** branch ごとの URL に `POST` すると build と deploy が走る。最初の build が始まる前に重ねて呼ぶと、重複分は省かれる。Cron の Worker から呼べる。出典: https://developers.cloudflare.com/changelog/post/2026-04-01-deploy-hooks/
- **公開までの遅れ:** 月 3,000 分をコードの push と分け合う。例えば 1回 5分なら、データ更新の build は1日 14回前後が上限で、間隔は約 100分になる（計算: 3,000分 × 0.8 の余裕 − push 分 300分 = 2,100分、÷ 5分 ÷ 30日）。実際の値は MIG-0409 で build 時間を測ってから決める。
- **鮮度が要るデータは build に載せない。** CURRENT で 30秒ほどで反映しているもの（枠の空き、いいね数、viewer overlay など）は、ページは build で作り、値は Hono API（S2）からブラウザが読む。分け方は MIG-0409 で表にする。
- **非公開化は build を待たない。** 公開→非公開の切替は、更新 API（S3）が同じ request の中で可視性の拒否 entry を書き、gateway（S1、MIG-0405）が読む。KV に置く場合、他の地域へ反映されるまで最大 60秒かかる（出典: https://developers.cloudflare.com/kv/api/write-key-value-pairs/ ）。60秒が許されない場合は MIG-0409 で止めてユーザーに確認する。
- **secret:** build 環境から D1 を読む API token と deploy hook の URL は secret。作成・登録は作業直前の明示承認事項（`CLAUDE.md`）。deploy hook の URL が漏れると、誰でも build 時間を使い切れる。

### task への割り当て

| task | 内容 |
| --- | --- |
| MIG-0409 | build 時に D1 から公開データを作る PoC。build 時間の実測、build に載せるデータと API で読むデータの分類表 |
| MIG-0410 | deploy hook を呼ぶ小さな Cron（1回 8ms 未満）。build 間隔と1日の上限を名前付き定数で持つ |
| MIG-0411 | 個別ページ（作品・ユーザー・イベント）を1件ずつ Queue で R2 HTML に作り直す（ISR 相当、1ページ max < 8ms） |
| MIG-0509 | 全公開データの生成を build 時へ移し、`apps/site` の読み取りを切り替える |
| MIG-0609 | 残る背景処理（状態を更新する job）の CPU を非本番で測る |
| MIG-0610 | 予算を超えた job を、1回 8ms 未満になるよう分割する |
| MIG-0907 | 本番切替と観測の後、`workers/json-generator` と static rebuild queue を消す |
