# FlameNode Migration Decisions — adopted options & remaining evidence

> Status: Active / 仕様上の採用方針と実行ゲートの正本
> Last updated: 2026-10-23
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
| D-09 | **A: 一覧・検索などの公開データは build 時に作り、更新は deploy hook で build を起こす。作品・ユーザー・イベントの個別ページは ISR 相当（更新されたページだけを Queue で R2 HTML に作り直す、2026-10-16 改訂）。残る背景処理は 1回 8ms 未満に分ける** | DECIDED | MIG-0409, MIG-0410, MIG-0411, MIG-0509, MIG-0609, MIG-0610, MIG-0907。`ZERO_1102.md` G2 | build 時の D1 読み取り用 token と deploy hook URL（どちらも secret）の作成、本番の Cron / Queue 変更は作業直前の明示承認<br>注: 個別ページの ISR 相当は Island 化した Phase 5 以降は D-11 により build cadence へ。Queue は DELETE/tracker のみ |
| D-10 | **共有 server core `@flamenode/server-core`（drizzle handle 注入、framework 非依存）を作り、Next（bridge 経由）と Hono の両方が使う** | DECIDED | MIG-0612〜0618。MIG-0603〜0605 の未着手 unit | source code の移動だけ。Remote D1 / deploy / Route / secret は対象外 |
| D-11 | **Island ページの queue 再生成の parity: Option 4（hybrid）。内容編集は build cadence、非公開化は即時（KV `deny:` + consumer の R2 DELETE）、consumer は描画しない。Island serializer port / `experimental_AstroContainer` 同梱は却下（B-new 8ms 超過、build hash と `builtAt` で byte parity 不能）** | DECIDED | MIG-0411 follow-up, MIG-0502/0504/0507, MIG-0509, MIG-0614 U06, MIG-0615 | Workers Builds 実測で 52 / 1,661,539 ms を再導出（実測前に Cron 頻度を上げない）。S3 が同一 request で `deny:` を書く実装（MIG-0614 U06 / MIG-0615）が揃うまで「非公開化は即時」は成立しない |
| D-12 | **Hono GET の S2 上限（LIMIT ≤ 100 / 応答 ≤ 64KB）と CURRENT 契約が衝突する read API は、CURRENT 契約を保ち「記録した例外」とする。viewer 固有の読みは named LIMIT で fail-closed（権限を増やさない形）、公開一覧の大応答は CURRENT 上限を維持して MIG-0606 の上限入力で max CPU を測り、7ms 超のときだけ additive paging を足す** | DECIDED | MIG-0604（live slots 6000、RH-014 own-slots 100 / 64KiB）、MIG-0611 の既存例外、以後の S2 task | MIG-0606 の実測（6000 枠入力、warm max）。推定値で判定しない。決定者: Fable（owner-delegate）2026-10-24、Yugo の standing instruction「検討事項は推奨で進めて」に基づく。Yugo には事後に伝える |

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
- 条件: 1ページの生成が **max < 8ms**。Queue consumer も 10ms の上限として扱う（[ZERO_1102.md](ZERO_1102.md) §1 の本番実測）。この 8ms は安全側の暫定予算で、MIG-0409 の U07（非本番の試験）と MIG-0906 の G2（本番の観測）で確定させる。MIG-0409 で測り、超えるページの種類は build（MIG-0410 の deploy hook）に回す。
- Next の ISR は再生成1回 16〜71ms だった（`docs/operations/workers.md`、ローカル計測）。React SSR を含むためで、Astro の1ページ生成（`experimental_AstroContainer.renderToString`、`node_modules/astro/dist/container/index.d.ts:227`、astro 5.18.2）は未計測。
- 一覧・検索索引・人気順など、多数の行から作るデータは build のまま（約 100分の遅れは下の制約のとおり）。

### 反映の速さの方針（ユーザー、2026-10-16）

「実測しながら、できるだけリアルタイムで反映できる方向で」。各データは次の順に試し、**実測で max < 8ms を満たす最も速いもの**を選ぶ。遅い方へ下げるときは計測値を PR に残す。

1. Island が API（S2）で読む（即時）
2. Queue で1件だけ作り直す（数分以内。個別ページ、MIG-0411）
3. Queue で分割して作り直す（一覧・検索索引を件数の上限付きの shard に分け、変わった shard だけを作る。数分〜）
4. build で作る（deploy hook、約 100分。MIG-0410）

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

## D-10 — Next と Hono が共有する server core（`packages/server-core`、2026-10-23 決定）

owner Yugo の standing instruction「検討事項は推奨で進めて」に基づき、lead が決定した。

背景: 監査付き mutation（`mutateWithAudit`）の呼び出しは 81 箇所・34 file、`mutate` + `logger` の import 連鎖は 32 file・約 4,000 行で、`server-only` 5・`getCloudflareContext` 直接 3・`@/` alias 8・`process.env` 1 を含む。MIG-0602 は Hono 側に監査の写し（Option A copy）を作って暫定的に動かしているが、写しを増やすと CURRENT との乖離が起きる（MIG-0603〜0605 は同じ監査・wake を再利用する）。`packages/domain` は DB を持たない純粋ロジックで、`apps/api` は HTTP の薄い層なので、どちらにも置けない。

決定: framework 非依存の server core `@flamenode/server-core`（`packages/server-core`）を作り、Next（`src/lib/**` の re-export bridge 経由、呼び出し側の変更 0）と `apps/api`（Hono）の両方が使う。

| 項目 | 内容 |
| --- | --- |
| DB | `drizzle-orm/d1` の drizzle handle を引数で受け取る。schema は `@flamenode/db`。relational API（`db.query.*`）は使わない |
| 許可 | transaction（D1 `batch`）、監査 INSERT、Queue wake の enqueue |
| 禁止 | `next/*`, `react`, `hono`, `astro`, `server-only`, `@/`, `src/`, `app/`, `process.env`, `getCloudflareContext`, `@opennextjs/cloudflare`（`scripts/check-server-core-boundaries.mjs` が検査） |
| 環境の注入 | env の値・KV・Queue・`waitUntil`・R2・edge cache・`unstable_rethrow` 相当は `src/ports.ts` の型で関数引数として渡す。Next 側の供給元は `src/lib/serverCore/nextPorts.ts`（MIG-0613） |
| 移さないもの | `src/lib/publicData/loader.ts`（[`ZERO_1102.md`](ZERO_1102.md) §4.1 / §4.7 と D-09 に反する）。境界のある純粋な `*Core.ts` だけを、各 API の task で必要になった時に抜き出す |
| 残すもの | `revalidatePath` / `revalidateTag` は Next の Server Action に残す（Hono は呼ばない） |
| 暫定 | MIG-0602 の `apps/api` の写し（Option A）は MIG-0617 で core に置き換えて削除する |

適用 task: MIG-0612〜0618（[`PHASE_6_SPEC.md`](PHASE_6_SPEC.md)）。MIG-0603 / 0604 / 0605 の未着手の unit は MIG-0613 / 0615 の後に core を使う。

| task | 内容 |
| --- | --- |
| MIG-0612 | D-10、package の足場、ports の型、境界検査、R-CORE レシピ |
| MIG-0613 | 監査 mutation core（`src/lib/audit/**` と `src/lib/queues/**` の wake） |
| MIG-0614 | static rebuild の enqueue、通知 batch、visibility fence store、public cache の削除 |
| MIG-0615 | video / event / xUser の可視性遷移 planner |
| MIG-0616 | audit restore |
| MIG-0617 | `apps/api` の Option A を core に置き換える |
| MIG-0618 | xid merge core |

決定の経緯: owner Yugo の standing instruction「検討事項は推奨で進めて」（推奨案と Fable の判断で決める）に基づく。lead の決定を Opus (high) と Fable が #338 でレビューして APPROVE した。

承認境界: source code の移動だけ。Remote D1、production deploy、Route、secret は対象外。D-10 は DB package の D-01 を変えない（schema は `@flamenode/db` のまま）。

## D-11 — Island ページの queue 再生成（DECIDED、2026-10-24）

決定者: Fable（owner-delegate）、2026-10-24、Yugo の standing instruction「検討事項は推奨で進めて」に基づく。Yugo には事後に伝える。Phase Gate の承認ではない。

### 決定

Option 4（hybrid）を採る。

- 内容編集の反映は build cadence（MIG-0410 の request-mark + hourly Cron debounce。最大 ≈60 min + build）で受け入れる。
- 正しさに関わる変更（非公開化・可視性）は従来どおり即時（KV `deny:` + consumer の R2 DELETE）。
- consumer（MIG-0411）の本番の役割は DELETE + tracker close のみ。`renderPublicPage.ts` の server-rendered 描画経路は本番 bundle から外す（renderer を削除。「lead が parity 回復か renderer 削除かを決める」は「renderer を削除」で決定）。
- 編集から公開反映までの遅延を縛る手段（consumer 経由の debounced Deploy Hook 呼び出し）は Workers Builds の実測後に判断する follow-up（下の E）とし、今は hourly Cron を基線にする。
- Option 1（Astro island serializer の port）と Option 2（`experimental_AstroContainer` 同梱）は却下。

### 根拠

1. CPU 予算で失格（決定的）: `ZERO_1102.md` §3 の B-new は「非本番の実プラットフォームで warm の最大値 < 8ms」。Island ページは一覧を含む（user の works/collabs 最大 120 行、event の slots、video の related）。MIG-0411 U05(a) の上限入力（一覧込み。video は members 100 / chapters 128 / related 30、event は works 8 / staff 20 / slot parts 20、user は works 8+8）での local Node wall ms の最大値は video 25.3–48.8、event 5.4–8.7（5/6 run で 8 ms 以上）、user 4.4–5.8 ms。user の最大 120 行は未計測の推定。一覧なしの consumer 経路（--snapshot）は video 0.8–1.2 / user 0.7–0.8 / event 0.4–0.5 ms。いずれも workerd では未計測。推定を実測扱いしない規範どおり最大値で判定すると、一覧込みの描画は 8ms に収まらない見込みで、結論は変わらない。Option 1/2 とも同じ React 木を描くので超過は変わらない。
2. byte parity は構造的に不可能: Astro の `<astro-island>` は build ごとに hash が変わる `component-url` / `renderer-url` と `_astro/*.css` を埋め込む（Worker が build manifest を持たなければ再現できない）。さらに `apps/site/src/pages/event/[id]/index.astro` は `builtAt = Math.floor(Date.now()/1000)` を props に埋める。Option 1 は「Astro の build 出力を Worker で模倣する第二の renderer」になり、MIG-0502/0504/0507 の Island が変わるたびに追従が要る（`CODE_QUALITY.md`「呼び出し元が1つの抽象」「移行で守る簡潔さ」に反する）。
3. Option 2 の無料枠/コールド: gateway dry-run は既に 577 KiB / 107 KiB gzip。Container 同梱は Astro runtime + 全ページ component を足す。cold isolate は React+UI の評価だけで +8.7–12.0 ms、`experimental_` API に本番の整合性を預けることになる。
4. Option 4 が regression を最小にする: privacy fence は gateway の KV deny（fail-closed）で build 周期と無関係。残る regression は「公開中ページの内容編集の遅延」のみ（CURRENT revalidate 30/60 s → 最大 ≈60 min + build）で、owner は 2026-10-18 に publish delay（60 min + build）を既に承認済み（`BUILD_TIME_DATA.md` §2 の MIG-0410 定数承認）。
5. 無料枠（Workers Builds）: 3,000 min/月。local 1.418 min/build で 52 builds/日（Cron で 24/日に cap）。Phase 5 で 1,460 ページ + snapshot 生産（≈145 D1 statement）が入るので build は長くなる。4 min/build なら 24/日 × 30 = 2,880 min で 80% 予算（2,400）を超える。よって定数 52 / 1,661,539 ms の再導出（Workers Builds 実測）は D-11 の前提条件。MIG-0410 は request-mark がある時だけ hook を呼ぶので、実 build 数は「変更のあった時間帯の数」以下。
6. Queue 無料枠が軽くなる: consumer が描画しないので consumer の R2 PUT は 0。ただし R2 Class A の書き込みは build 側へ移る。毎 build で全ページを再 PUT すると 24 builds × 1,460 = 35,040/日 ≈ 1.05M/月 ≈ Class A 無料枠 1M/月の 105% になるため、差分 PUT か build 頻度の制限が必要（下のリスクと `BUILD_TIME_DATA.md` §6）。doorbell（≤1,460/日）と recovery（≤120/日）は従来見積りのまま ≤ 47%。gateway `rebuild-page` は excluded kind では `excluded_kind` で即 finish されるため消費は 3 ops/件のままで、F-02 の「stale は配信」により 503 は増えない。

### リスク / 残余

- 新規公開ページ: route shard にない path は 404、shard にあって R2 HTML がない path は 503（`BUILD_TIME_DATA.md` §3.1）。新作は次の build（≤ ~60 min + build）まで到達不能。CURRENT は 30 s。D-11 の受容範囲に含める（owner 承認済みの publish delay と同じ数値）。短縮は follow-up E。
- KV deny の writer が未実装: `revocationKey` の利用者は gateway/consumer のみ。S3 の非公開化 API が同一 request で `deny:` を書く実装（MIG-0615 visibility transition / MIG-0614 U06）が揃うまで「非公開化は即時」は成立しない。D-11 の適用条件。
- producer 配線（MIG-0614 U06）未完: doorbell が無い間は consumer の DELETE も届かない（gateway miss 経路のみ）。U06 の予算判定は「S3 に D1 statement +1、Queue message +1」のみで変わらない。
- event の時刻依存ラベル（entry 開始/終了・status）: Island が `builtAt` 起点で clock 再計算する設計（MIG-0502）なので build 周期の影響を受けない。release/slots の filled 数は `GET /api/live/...` で browser 取得。
- R2 Class A の書き込み予算: R2 への書き込みは consumer から build に移る。毎時の build が全ページを PUT すると 24 builds × 1,460 = 35,040/日 ≈ 1.05M/月（無料枠 1M/月の約 105%）。MIG-0509 は差分 PUT（変更のあったページだけ）か build 頻度の制限で月 800k（80%）以下にする。どちらかが成立するまで、毎時 build で全ページを PUT する運用は開始しない。
- Workers Builds の実測が未取得: 無料枠超過の判定は推定。実測前に hourly 以上の頻度へ上げない。

### 再検討条件（いずれかで D-11 を再開）

1. Workers Builds 実測で 1 build が 4 min 以上、または日次 cap が 12 未満になる。
2. Astro Container が stable になり、かつ非本番 platform の warm 最大値（一覧込み）が kind 単位で < 8ms と実測される（その kind だけ `server-rendered` に戻す）。
3. owner が編集反映 60 min を運用上受け入れられないと判断した。

### Follow-ups to register (not yet MIG tasks)

下の A-F は未登録。MIG task 化には STATUS / Work Order / task card の登録が要り、lead が別途行う。

| ID | 題名 | owner model | 依存 |
| --- | --- | --- | --- |
| A | **登録済み（2026-10-24）: MIG-0411 work item の unit として。新 MIG id は作らない。** MIG-0411 follow-up: consumer から描画経路を削除（DELETE + tracker close のみ）。`renderPublicPage.ts` の server-rendered 分岐と React/UI dynamic import、`PUBLIC_PAGE_STYLESHEETS` 設定、`renderPublicPage.measure.mjs` を削除。`PAGE_BODY_FORMAT` は削除か `excluded` 固定。`pageRenderQueue.test` の byte-equal characterization を excluded/delete シナリオに置換。bundle size を再計測 | Sonnet 実装、Opus review | なし（D-11 docs PR 後） |
| B | MIG-0410 follow-up: Workers Builds 実測と定数再導出（`BUILD_TIME_DATA.md` §2 手順 1–4）。非本番 build probe project（owner 承認要）、5 回計測、`MAX_DATA_BUILDS_PER_DAY` / `MIN_BUILD_INTERVAL_MS` 再導出 | owner 操作 + Sonnet 記録 | MIG-0509 の build command 配線 |
| C | MIG-0509 U: build-written HTML の R2 PUT と route generation 維持。F-02 の metadata 契約、data-only build で generation を維持、PUT 件数の記録。受け入れ条件: 月間 Class A の見積りが予算以下（差分 PUT か build 頻度の制限で達成。件数の記録だけでは不可） | lead（Opus）精緻化 → Sonnet 実装 | MIG-0507 merge（済）、MIG-0509 producers（#354 済） |
| D | **登録済み（2026-10-24）: MIG-0614 work item の unit U06 として。新 MIG id は作らない。** MIG-0614 U06: producer 配線（doorbell + `requestPageRenderStatement`）+ S3 で `deny:` を同 request で書く。golden の意図的更新、S3 予算（statement +1、message +1）、`revocationKey` 利用 | Sonnet 実装、Opus review | A、Queue binding の owner 承認、MIG-0615 |
| E | （評価のみ）debounced event-driven build trigger の設計判断。consumer（または S3 の doorbell 到達時）が `decidePublicBuild` の CAS 行で Deploy Hook を直接呼び、公開/新規作成の反映を ≈ build 時間まで短縮する案。gateway Worker への `PUBLIC_BUILD_DEPLOY_HOOK_URL` secret（承認要）と Cron 併用時の二重 trigger 防止を評価 | Opus（調査、コード変更なし） | B の実測結果 |
| F | MIG-0615/0502 確認: event 時刻依存ラベルと slots filled 数が build 周期に依存しないことの parity test 追記（既存設計の確認のみ） | Sonnet | なし |

## D-12 — S2 上限と CURRENT 契約の衝突（DECIDED、2026-10-24）

決定者: Fable（owner-delegate）2026-10-24、Yugo の standing instruction「検討事項は推奨で進めて」に基づく。Yugo には事後に伝える。merge / Phase Gate / 本番操作（Route・Remote D1・secret・deploy）はこの決定に含まない。

- 公開一覧で CURRENT が大きな上限を持つもの（live slots `MAX_LIVE_SLOTS = 6000`、約 890 KiB）: CURRENT の上限・truncated・cache 契約を保ち、PHASE_6_SPEC の「記録した既知の差・例外」に残す。MIG-0606 が「上限ちょうど」入力（6000 枠・`public_name`）で warm max を 50 回以上測り、7ms 未満なら恒久例外、7ms 以上なら additive paging（optional `limit` ≤ 100 + `cursor`、無指定時は従来の応答）を担当 MIG の追加 unit で入れる。ページング化を先行して契約を変えることはしない。推定値で判定しない。
- viewer 固有の読み（RH-014 own slots 100 件 / 64 KiB、pending 申請 100 件）: named LIMIT を超えたら権限を増やさない fail-closed（CURRENT の既存 `authUnavailable` 形）で返す。ページング化しない。
- MIG-0631（RH-015）の訂正（DECIDED、Fable（owner-delegate）2026-10-24。Yugo には事後に伝える）: 当初の追加差分「MIG-0631 は normal 時 D1 fallback を廃止」は前提が違っていたので取り消す。CURRENT の RH-015 は normal / economy / read_only で毎回 D1 が主経路で（`app/api/events/route.ts` L91-L113）、R2 artifact を使うのは `static_json_only` のときだけ（同 L40）。Hono も同じにする: live mode は D1 1 文（`WHERE visibility_status = 'public' ORDER BY start_time DESC, created_at DESC LIMIT ? OFFSET ?`。`LIMIT` は request の `limit`（既定 60、上限 `MAX_PUBLIC_EVENT_LIMIT` = 60。`route.ts` L27-L31 / L112-L113）、R2 read 0）、static_only は R2 artifact（欠損・空 `items`・壊れた JSON は 503 `public_data_unavailable`）、maintenance は 503。S2 に収まる。`ZERO_1102.md` §4.7 は miss 経路の規則で、主経路の bounded read には当たらない。D-09 とも整合する。採らない案: 全 mode で artifact（point event の消失・200 件の打ち切り・同時刻の並び・反映の遅れ・空 index の 503）。詳細は `PHASE_6_SPEC.md` MIG-0631 L4。
- 読み取り失敗の status（200 固定形 → 503 + Retry-After）、暗黙の行順の明示（`ORDER BY`）は S2 のための差として承認。
- CURRENT の不具合（`slotViewerOverlay.ts` の event select に `visibility_status` が無く `operatorOverrideAllowed` が常に false）は Hono でも bug-compatible のまま。修正は挙動変更なので FIX-0604-1（MIG-0633 の後、Next と Hono を同一 PR で）として扱う。
