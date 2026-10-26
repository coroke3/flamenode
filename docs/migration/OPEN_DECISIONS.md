# FlameNode Migration Decisions — adopted options & remaining evidence

> Status: Active / 仕様上の採用方針と実行ゲートの正本
> Last updated: 2026-10-26
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
| D-13 | **部分 merge 済み task の残りを分割（MIG-0510〜0512, MIG-0634〜0638 を登録）、Phase 5 ページの依存を MIG-0407 へ、MIG-0409/0617/0620/0625 を DONE に整理。個別の決定 D-13-1〜60 は §D-13** | DECIDED | MIG-0409〜0411, MIG-0501〜0512, MIG-0603〜0607, MIG-0617, MIG-0620, MIG-0625〜0629, MIG-0633〜0638, MIG-0701/0702/0704/0705 | 本番操作は各 Work Order の STOP の owner 手順。決定者: Claude Opus（owner-delegate）2026-10-25 |
| D-14 | **依存の見直しと大きい READY task の分割（MIG-0639〜0649, MIG-0513〜0515 を登録）。個別の決定 D-14-1〜14 は §D-14** | DECIDED | MIG-0507, 0510, 0513〜0515, 0603, 0606, 0609, 0621, 0627, 0628, 0632, 0636〜0649, 0802 | 本番操作（Remote D1・secret・deploy・Route）は従来どおり作業直前の明示承認 |
| D-15 | **MIG-0633 の DONE を受けて書き込み API を SA 群ごとに分割（MIG-0650〜0660）、build 側の残り（MIG-0516〜0518）、Ops SPA の土台（MIG-0707）、code 側の残存棚卸し（MIG-0908）を登録。個別の決定 D-15-1〜15 は §D-15** | DECIDED | MIG-0509, 0513, 0514, 0516〜0518, 0603〜0607, 0626, 0636, 0650〜0660, 0702〜0707, 0901, 0908 | 本番操作（Remote D1・secret・deploy・Route・Queue binding）は従来どおり作業直前の明示承認 |
| D-16 | **API 待ちの画面・Island を契約先行で着手できるようにする（Merge gate）。MIG-0702 / 0703 / 0513〜0515 を分割（MIG-0519, 0708〜0718）、CostGuardBanner の読み API（MIG-0661）、既存 Hono session の security review（MIG-0807）。個別の決定 D-16-1〜14 は §D-16** | DECIDED | MIG-0513〜0515, 0519, 0606, 0607, 0636, 0640, 0641, 0648, 0650, 0651, 0657, 0659, 0661, 0701〜0705, 0708〜0718, 0804, 0807 | 本番操作（Remote D1・secret・deploy・Route・Queue binding）と SPA の本番 Route 切替は従来どおり作業直前の明示承認 |
| D-17 | **Ops SPA の画面を画面群に分割（MIG-0719〜0737）、SA-011 の API（MIG-0662）、Manage navigation の 2 field（MIG-0663）、Ops guard の degraded の写像（MIG-0664）。個別は §D-17** | DECIDED | MIG-0606, 0607, 0626, 0637, 0642〜0644, 0662〜0664, 0704〜0707, 0719〜0737 | 本番操作（Ops の Worker / Route / Custom Domain、Remote D1、secret）は従来どおり作業直前の明示承認 |

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
- CURRENT の不具合（`slotViewerOverlay.ts` の event select に `visibility_status` が無く `operatorOverrideAllowed` が常に false）は Hono でも bug-compatible のまま。修正は挙動変更なので FIX-0604-1（MIG-0633 の後、Next と Hono を同一 PR で）として扱う。 → 2026-10-25 PR #410 で Next / Hono を同時に修正（event select に `visibility_status` を追加、承認済み linked X の staff `event.slots` または admin、規約同意、エントリー開始前の窓）。

## D-13 — 部分 merge 済み task の残りを分割し、着手可能な task を増やす（DECIDED、2026-10-25）

決定者: Claude Opus（owner-delegate）2026-10-25。Yugo の standing instruction「判断は推奨案で進め、事後に報告」（2026-10-22 / 2026-10-23）と、2026-10-25 の依頼「次の 20 タスクくらいを実装開始可能な状態にして」に基づく。Fable は使っていない。Yugo には事後に伝える。各項目の根拠は該当 Work Order と下の理由。本番操作（Remote D1・secret・Queue/Route 作成・deploy）は決めていない（各 Work Order の STOP の owner 手順）。

- **D-13-1** (owner-delegate, 2026-10-25): MIG-0502..MIG-0506 の STATUS 依存を MIG-0501 / MIG-0505 から MIG-0407（Phase 4 Gate、DONE）に替える。共有の `PublicLayout` / `pageHead` は #340 で merge 済みで、各 task の残りは MIG-0501 の未完了範囲に触れない（コードで確認: Phase 5 の全ページが `PublicLayout.astro` + `pageHead.ts` を import。例外は MIG-0619 の `maintenance.astro`）。
- **D-13-2** (owner-delegate, 2026-10-25): Phase 6 API を要る公開ページの操作部品（`/rules` 同意 form、`/slots` 予約、`/list` ListFilterIsland と top の検索帯、`/[id]` の like/bookmark/chapter/status、header の Active X 切替）は各ページ task から外し、新 task MIG-0510 にまとめる。理由: ページ task が API 待ちで止まらないようにする。
- **D-13-3** (owner-delegate, 2026-10-25): 公開 X アイコン map の projection（MIG-0502 gap 2、MIG-0504 gap 2、MIG-0507 blocker 5）は新 task MIG-0511（build 時 snapshot）にまとめる。
- **D-13-4** (owner-delegate, 2026-10-25): The MIG-0620 `/_ops_assets/*` immutable rule goes to MIG-0704 U01, the task that creates `apps/ops`, and MIG-0620 is DONE. Reason: there is nothing to put a rule on until `apps/ops` exists. The table value is fixed (the same as `/_personal_assets/*`) and the test that pins it already exists.
- **D-13-5** (owner-delegate, 2026-10-25): The MIG-0701 stylesheet port copies the CURRENT global cascade **unchanged**: `src/styles/{globals,redesign-public,mobile-public,admin-manage,admin-mobile}.css` (globals.css `@import`s the other 4 at lines 7-10) and `src/styles/mobile-hardening.css` go to `apps/app/src/styles/current/`, imported in the CURRENT order (`app/layout.tsx:4-5`). The 4 CSS modules are converted mechanically to `dash-` / `onb-` / `settings-` / `vcard-` classes. The scoped `fn-*` subset with a scope lint (the `packages/ui/test/eventsCssScope.test.mjs` pattern) is rejected. Reasons: (a) `apps/app` is its own bundle and loads only on Personal routes, and CURRENT loads the same whole cascade on those routes, so there is nothing to scope against. (b) The rules for one class are spread over 5 files with mobile and media overrides, so a subset would change the cascade. (c) A byte-identical copy plus a drift test follows the existing `apps/app` precedent (`onboarding.test.mjs:126`, the terms sources). The cost is about 236 KB raw / 35 KB gzip of CSS, all hashed under `/_personal_assets/`.
- **D-13-6** (owner-delegate, 2026-10-25): The `(auth)/layout.tsx` chrome (`PublicHeader` with account hydration, `PublicFooter`, `CostGuardBanner`) moves out of the MIG-0701 DONE checklist into lead follow-up **FIX-0701-1** (personal shell). FIX-0701-1 must be DONE before the `/dashboard` Route switch and goes on the MIG-0706 Gate checklist. Reasons: the header account and theme Islands live in `apps/site/src/components/{AccountMenu,ThemeToggle}.ts` (MIG-0507, IN_PROGRESS; AccountMenu imports CURRENT `src/lib/**` by relative path), so `apps/app` cannot reuse them without a cross-app import. `CostGuardBanner` reads operation mode from D1/KV on the server, and no Hono endpoint exposes it (`apps/api/src/routes/live/operationMode.ts` exports only a resolver, and app.ts mounts no route for it). MIG-0704 and MIG-0705 have the same need, so FIX-0701-1 should provide the shell to both SPAs.
- **D-13-7** (owner-delegate, 2026-10-25): The MIG-0701 browser check at 390/1440 is **not** a DONE item. It moves to the Route-switch smoke (MIG-0706 Gate). Reasons: `apps/api` has no local runtime config (wrangler) that would let the SPA show real data, and the Phase 7 common contract says the private mock is a reference only, not a Gate (PHASE_7_SPEC.md:32, UI_REFERENCE.md "非公開はCURRENT UIを維持"). Visual parity is covered by identical markup classes (tested since PR #374) plus the byte-identical CSS (U04 drift test).
- **D-13-8** (owner-delegate, 2026-10-25): The SPA HTML routes are served with `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate` through `apps/app/public/_headers` rules for `/dashboard`, `/dashboard/*` and `/onboarding`. This is the Next.js value for `force-dynamic` pages, which CURRENT uses (`app/(auth)/layout.tsx:11`); it could not be confirmed locally because node_modules is absent. noindex is the `<meta name="robots" content="noindex, nofollow">` in `index.html` (CURRENT `(auth)/layout.tsx:8-10` metadata), and no X-Robots-Tag is added because CURRENT sends none on these pages. Whether Static Assets applies these rules to the SPA fallback response is checked in the MIG-0706 smoke.
- **D-13-9** (owner-delegate, 2026-10-25): MIG-0702 depends on the MIG-0605 child MIG-0636 (D-13-56), not on the whole of MIG-0605. MIG-0636 covers: SA-076, SA-098..105, and the `POST` for `maybeMarkOnboardingComplete`. Reason: MIG-0605 also holds spreadsheet, media, public staff and admin ops (U02-U07), which `/dashboard` never calls.
- **D-13-10** (owner-delegate, 2026-10-25): MIG-0409 → DONE. PR #323 merged `4f90bc9d`; U01/U02/U04/U07 done; U03 Workers Builds re-measure is tracked in MIG-0509 (owner step); U05 is moot under D-11 (no Queue render); U06 dropped (D-13-15). The read-only token step (BUILD_TIME_DATA.md §5) moves to MIG-0509 STOP/owner steps. Reason: every remaining item is an owner Cloudflare step already owned by MIG-0509; keeping 0409 BLOCKED only blocks MIG-0411 / MIG-0509.
- **D-13-11** (owner-delegate, 2026-10-25): the event/video mirror deviation (`apps/site/scripts/mirrorTables.ts`, keyset-paged SELECTs + CURRENT generators on a scratch DB) is accepted for MIG-0509. Reason: output equals CURRENT by construction and the byte parity test (`scripts/migration-snapshot-producers.test.mjs` "C' parity") is the gate; a set-based copy of ~600 lines would drift silently.
- **D-13-12** (owner-delegate, 2026-10-25): reader cap. `produceSnapshots.ts` passes `maxStatements: DEFAULT_MAX_REMOTE_STATEMENTS` (200, `produceSnapshots.ts:144`) to `openD1HttpReader` (`readPublicData.ts:364`, option `maxStatements` already exists :378). `MAX_D1_HTTP_STATEMENTS = 19` (`readPublicData.ts:348`) stays for the events-index CLI. Reason: one-argument change, no constant semantics change, both caps stay tested.
- **D-13-13** (owner-delegate, 2026-10-25): **detail HTML stays in Static Assets; the build writes no R2 HTML.** MIG-0509 U-build-html and U-route-generation are dropped; D-11 follow-up C is closed by this decision. Reason: under D-11 the build is the only HTML source, so R2 HTML and Assets have the same freshness; the gateway reads Assets first and R2 only on an Assets 404 (`apps/site/src/gateway/index.ts:159-184`); ≤ 1,766 files = 8.8 % of 20,000 (`BUILD_TIME_DATA.md` §6); unpublish is fenced by KV `deny:` before Assets (§3.2). Removes the R2 Class A risk (35,040 PUT/day) and the build write credential.
- **D-13-14** (owner-delegate, 2026-10-25): trending input of the build = `analytics/trending.json` read once per build from R2 through the Cloudflare REST API (`GET /client/v4/accounts/<account>/r2/buckets/flamenode-storage/objects/analytics/trending.json`) with a read-only token (Workers R2 Storage Read). The owner may put D1 Read and R2 Read on one custom token. No write credential in the build. Reason: GA4 output is not derivable from D1 (`produceSnapshots.ts` work item "Known limits 1"); listing / top builds fail closed without it.
- **D-13-15** (owner-delegate, 2026-10-25): MIG-0409 U06 (Queue-shard CPU) is dropped. Every list / search family is produced inside the build (`produceSnapshots.ts:268-276`, Runtime N), none is a Queue shard, so the B-new 8 ms budget does not apply.
- **D-13-16** (owner-delegate, 2026-10-25): `/[id]` keeps strict fail-closed for a manifest-allowed missing/non-public video object (`videoPage.ts:46`, T02 in `migration-video-page.test.mjs`); no alignment to the event loader's skip policy. Reason: `produceSnapshots.ts:347-351` writes `allowedKeys` from the same in-memory result as the objects, so a gap is a producer bug.
- **D-13-17** (owner-delegate, 2026-10-25): `/[id]` playlist link comes from the build-time `event-detail` snapshot of the primary event (`event.youtube_playlist_id`, CURRENT `EVENT_DETAIL_COLUMNS` `workers/json-generator/rebuild.ts:272-283`), shown under CURRENT's condition `scheduled_time > now` (`app/(public)/[id]/page.tsx:120-128`) evaluated at build time. No R2 playlist reader. The link can stay up to one build cycle after `scheduled_time` (D-11 accepted delay class).
- **D-13-18** (owner-delegate, 2026-10-25): sign-out (`/api/auth/csrf`, `POST /api/auth/signout`, `/api/auth/session`) is a Phase 8 cutover dependency (MIG-0802; the gateway already forwards `/api/auth/*` to the Auth.js origin, `scripts/migration-gateway.test.mjs:220`), not a MIG-0507 blocker.
- **D-13-19** (owner-delegate, 2026-10-25): MIG-0511 covers public build-time consumers only. Admin users `?view=xid` `icon_url` (MIG-0625 blocker 5) goes to MIG-0635 (admin read part C): a Hono S2 route cannot read a build-time snapshot.
- **D-13-20** (owner-delegate, 2026-10-25): the page-render Queue binding name is `REBUILD_QUEUE` (code: `apps/site/src/gateway/index.ts:43,184,284`), not `PAGE_RENDER_QUEUE` (MIG-0411 work item owner step 2). Owner config uses the code name.
- **D-13-21** (owner-delegate, 2026-10-25): MIG-0411 U04 host = the hourly `flamenode-fast-jobs` Cron (no new cron expression, 4/5 used). The recovery SQL moves to a dependency-free module so fast-jobs does not bundle the gateway consumer.
- **D-13-22** (owner-delegate, 2026-10-25): MIG-0507 no longer depends on MIG-0502..MIG-0506. The "0507 last" order is the production cutover order (`PHASE_4_5_SPEC.md` 本番移行順), enforced by the Phase 5 Gate and per-route human cutover approval, not by the code dependency. MIG-0508 lists MIG-0501..MIG-0507 explicitly.
- **D-13-23** (owner-delegate, 2026-10-25): an icon-map snapshot that is absent or fails verification gives an empty map + build warning (CURRENT `loadPublicXIconMapOptional` returns null → empty map, `staticSharedInputsLoader.ts:375-381`), never a build failure.
- **D-13-24** (owner-delegate, 2026-10-25): MIG-0510 is one task with 5 units, each unit merges when its API is DONE; the task is DONE only after all 5.
- **D-13-25** (owner-delegate, 2026-10-25): The gateway items found in Phase 5 go to a new task, MIG-0512 (lead, R-GATEWAY, S1, deps MIG-0405 + MIG-0619, both DONE). They are: the HTML 404/503 bodies with `Retry-After` (0501 T10/G10), the fence for entity sub-pages `/event/{id}/release`, `/event/{id}/slots` and `/user/{id}/portfolio` (0502 gap 7; slots currently skips the KV fence), and the `/user/index.json` + `/fonts/*` allowlist (0504 gap 4; the font preload 404s behind the gateway). MIG-0508 gets it as a dependency. Reason: `apps/site/src/gateway/index.ts` should have one owner, the change is security-relevant (revocation fence), and it is not page work.
- **D-13-26** (owner-delegate): The gateway sends 503 with `Retry-After: 30`. Reason: this is CURRENT's convention for retryable public 503s (`app/api/public/about-stats/route.ts:17`, `app/api/media/[...key]/route.ts:13`). CURRENT pages have no 503.
- **D-13-27** (owner-delegate): `/maintenance` moves from `PublicPage.astro` to `PublicLayout.astro` (noindex head, shared header/footer, stored theme). Reason: CURRENT `app/(public)/maintenance/page.tsx` renders inside `app/(public)/layout.tsx` (PublicHeader/PublicFooter) and the root theme bootstrap. `/_astro/*` is already exempt from the maintenance redirect (`edgePolicy.ts:115`), so the header Island loads while maintenance is on.
- **D-13-28** (owner-delegate): There is no screenshot script in the repo, and I add none. The reusable piece is one bash snippet (build → `python3 -m http.server` → `playwright screenshot`, at 390x844 and 1440x900, full page, `--color-scheme=dark` because the mock defaults to dark). It goes in "Phase 5 共通契約" (this docs PR owns it), and every Work Order repeats it with its own routes. Reason: playwright 1.63 is preinstalled (`/opt/node22/bin/playwright`, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; I checked that it works on 127.0.0.1), and a script owned by one task would make the other tasks wait for it. Screenshots are not committed; the PR body lists route × width and the differences. Every difference is put in one class: (a) a row of the task's CURRENT_DIVERGENCE table, (b) mock sample data (text, counts, images), (c) anything else. Any class (c) difference → STOP, return to lead, do not fix.
- **D-13-29** (owner-delegate): The about-stats wiring needs no new code. It is already covered by `scripts/migration-snapshot-producers.test.mjs:130-142` (stats deep-equal to CURRENT RH-026 counts), `:323-335` (real astro build, `/about` contains the count) and `scripts/migration-public-shell.test.mjs:161` (fail-closed loader). MIG-0501 records this evidence and closes gap 1.
- **D-13-30** (owner-delegate): MIG-0501 copies CURRENT `public/brand/*` (10 files), `public/favicon.ico`, `public/manifest.webmanifest` and `public/logo.png` into `apps/site/public/` byte for byte (gap 5). Reason: `PublicLayout.astro` and `pageHead.ts:8,26` already link these files, and the gateway allowlist already serves them (`routeShards.ts:91-98`), but the Astro build does not ship them. `robots.txt` stays with MIG-0621.
- **D-13-31** (owner-delegate): MIG-0502 recruit card: reuse MIG-0506's ported card. `TopView.tsx:85` `Recruit` is exported as `RecruitCard`, and the model is built like `topData.ts:104` `toRecruit`, but with CURRENT's event-page CTA (`app/(public)/event/[id]/page.tsx:269-277`). The card is shown only when status ≠ ended. Slot counts are `null` in the build HTML; `EventDetailIsland` fills them from RH-020, as it does for the metrics. The timeline ruler is not drawn, the same divergence as the top page. Accent: `buildAccentVars(accent_color, "dark")` as the root `style` on `/event/[id]` and `/slots` (CURRENT `event/[id]/page.tsx:176-178`, `slots/page.tsx:218`; `/event` groups already do this at `eventIndex.ts:252`).
- **D-13-32** (owner-delegate): Repeated query keys (`?q=a&q=b`) keep the first value. Reason: CURRENT does not "read the array form". `EventIndexView.tsx:172` calls `rawParams.q?.trim()` on a `string[]`, which throws a TypeError and shows the error page. That crash is not reproduced. Recorded as CURRENT_DIVERGENCE.
- **D-13-33** (owner-delegate): An event without a release object gets no `/event/{id}/release` page (already the case). The 404 status comes from MIG-0512 (a sub-page asset miss is 404, not the R2 fallback 503).
- **D-13-34** (owner-delegate): MIG-0503 accepts the source-read evidence plus the T03 equivalence, and is marked DONE without running a CURRENT server. Reasons: the CURRENT pages are 3-line `redirect()` calls with no data (`app/(public)/groups/page.tsx:3-5`); `next dev` is not the production OpenNext runtime and needs `npm ci` + local bindings, so it adds no stronger evidence; production `flamenode.net` is blocked by the sandbox proxy (403, checked). An optional owner step (6 read-only `curl -sI`) is under STOP.
- **D-13-35** (owner-delegate): MIG-0504 T03 becomes "an unknown/merged X ID answers 404, as CURRENT does". CURRENT has no old-ID redirect (`UserProfilePage.tsx:228,242,305,307` = `notFound()`). D-03 is the like/bookmark fan-out rule, not a URL alias rule. Case folding is already in the gateway (`routeShards.ts:44-48` `normalizeKey`; test "user slugs follow CURRENT normalizeXId" in `scripts/migration-gateway.test.mjs:175`).
- **D-13-36** (owner-delegate): Profile Island size budget. The props JSON (`{works, collabs}` at 15+15 display pages × 8 cards, 100-character titles) must stay ≤ 262,144 bytes UTF-8 (256 KiB). Over budget → STOP, and the lead moves pages to per-page JSON. Reason: this keeps the profile HTML under about 0.5 MB after Astro attribute escaping. Real data is not reachable by agents (no Remote D1), so a synthetic maximum is the only honest measurement.
- **D-13-37** (owner-delegate): Clock-dependent labels (0502 gap 3, 0505 gap 4, 0506 gap 3) stay evaluated at build time. Their freshness depends on MIG-0509's build cadence (D-11). This is not a STATUS dependency: MIG-0509 depends on MIG-0507, which depends on 0502..0506, so it would be a cycle. MIG-0508 covers it through its MIG-0509 dependency.
- **D-13-38** (owner-delegate): The top shelves keep shuffling per build with `Math.random` (`topData.ts:160-161`). Reason: CURRENT also shuffles on every ISR regeneration, and D-11 already rules out byte-reproducible builds (build hash, `builtAt`). Gap 4 is closed as parity.
- **D-13-39** (owner-delegate): The `/event` search form uses `@flamenode/ui` `ImeSafeGetForm` (0502 gap 4), as CURRENT does (`app/(public)/event/EventIndexView.tsx:7,264`) and as `CreatorsView.tsx:65` already does.
- **D-13-40 (owner-delegate, 2026-10-25)**: SA-001〜003 と SA-043/044（moderation の作成・更新。どちらも `planVideoVisibilityTransition` を `admin_moderation_create` / `admin_moderation_update` で呼ぶ。`src/lib/actions/moderation-admin.ts:172,303`）は、`apps/api` の Hono 用 `VideoVisibilityTransitionHost` を1つ作って共有する。SA-043/044 は MIG-0605 から MIG-0603 へ移す。理由: host を2回作らない。
- **D-13-41 (owner-delegate, 2026-10-25)**: D-0603-1 を通知の Queue wake にも広げる。`apps/api` の可視性遷移・通知管理の書き込みは `notification_outbox` の行を同じ batch に書き、wake は 0。回収は fast-jobs の cron `0 * * * *`（`workers/fast-jobs/wrangler.toml:12`、`workers/fast-jobs/index.ts:226-245` の `notification_available`）で最悪約 60 分。理由: `apps/api` に Queue binding が無い（D-0603-1）。binding は MIG-0614 U06 / MIG-0628 で1回決める（Yugo の明示承認事項）。Phase 7 の UI 切替時に owner が 60 分を拒否したら再検討。
- **D-13-42 (owner-delegate, 2026-10-25)**: host が渡す公開 cache key のうち、event export の key（`EVENT_EXPORT_REFRESH_MINUTES`, `eventExportPayloadCacheKey`, `isEventExportRefreshMinutes`。`src/lib/api/eventExportCache.ts:9-41`）は server-core `publicCache/eventExportKeys.ts` へ移し（bridge）、object key 定数（`RANDOM_VIDEO_POOL_OBJECT_KEY` ほか6つ、`STATIC_USER_MAX_PAGES`、event の composed/base/slots key。`src/lib/video/videoVisibilityTransition.ts:47-63`）は `apps/api` に定数として写し、src の値との drift test で固定する（`schemaCatalog.ts` と同じ形）。理由: 定数の import 元（`src/lib/publicData/*Core.ts`）は UI 型を引き込むので丸ごと移すと範囲が広がる。ロジックは写さない（D-10）。
- **D-13-43 (owner-delegate, 2026-10-25)**: 可視性遷移の書き込み（SA-001〜003/040〜044）は CURRENT の事前読み（video、rebuild event ids、planner の通知 prefetch 2（`VIDEO_STATUS_NOTIFICATION_PREFETCH_QUERY_COUNT`）、moderation case、approve-and-next の次 href）をそのまま行う。ZERO_1102 S3（事前読み3つ）を超えるのは記録した例外とし、test が D1 文数を固定する。CPU は MIG-0606 で判定（warm max ≥ 8ms なら担当 unit に戻す）。理由: 読みを減らすには planner（Next と共有）を変える必要があり、挙動変更になる。
- **D-13-44 (owner-delegate, 2026-10-25)**: MIG-0603 は READY のまま unit gate を置く。U02c / U03b / U03c は MIG-0633 DONE まで着手しない。lead は U02a〜U03a の merge 後に STATUS の MIG-0603 依存へ MIG-0633 を足す。SA-086/088/089（`createFreeVideo` 430 行、`submitSlotVideo` 732 行、`updateVideo` 815 行、`src/lib/video/videoSavePlan` 系）は大きいので、lead が別 MIG に切り出すことを推奨（本稿の ID 範囲外なので登録しない）。
- **D-13-45 (owner-delegate, 2026-10-25)**: SA-087（いいね）は B-5 解消済みとして扱う。core の `buildStaticRebuildQueueBatch` は prefetch 0（`packages/server-core/src/staticRebuild/enqueue.ts:69`）で、`list_popular` も1文の UPSERT に入る。読みは guard の user 1 + CostGuard の settings 1 + 「video 行と自分の interaction を LEFT JOIN した1文」= 3 で S3 に収める。
- **D-13-46 (owner-delegate, 2026-10-25)**: MIG-0634 は MIG-0631 の L3/L5 と同じにする。GET は書かない（miss で enqueue しない、`public_data_reflecting` を返さない）、stale cache なし、degraded D1 fallback なし（CURRENT `loadStaticVideoDetail` の `degradedFetcher`、`src/lib/publicData/loader.ts:1960-1975`）。RH-031 の公開判定は CURRENT と同じく artifact（`videos/<id>.json`）で行う。理由: 匿名 GET に書き込み経路を作らない。degraded は障害時の mode で、差は 503 で fail-closed 側。
- **D-13-47 (owner-delegate, 2026-10-25)**: RH-031 の「チャプターを編集できるか」は既存の `apps/api/src/routes/videos/chapterAccess.ts#canAdministerChapters`（MIG-0603 U02b で CURRENT と parity 済みの `video.chapter_admin`）を使う。MIG-0633 を待たない。
- **D-13-48 (owner-delegate, 2026-10-25)**: MIG-0625 は範囲を縮めて DONE。`events/[id]`, `/edit`, `/slots`, `/staff` は `redirect()` だけの page（`app/(admin)/admin/events/[id]/slots/page.tsx:16` など）で ROUTE_MATRIX.md:192 で NONE。`events/templates`, `event-groups/*` は DONE 済み。残り `videos/[id]`, `videos/[id]/members`, `users/[id]/edit` → MIG-0635。`events/new` の `formInitial` は API が `settings_json` をそのまま返す今の形を正とし、変換（`src/lib/admin/eventTemplateSettings.ts:251` `parseEventTemplateSnapshot`、`:347` `snapshotToFormInitial`）は MIG-0604 U04 の SA-035（`snapshotFromEvent`、同じ file）で domain へ移したものを MIG-0705 の SPA が呼ぶ。理由: 同じ file を2つの task で移さない。
- **D-13-49 (owner-delegate, 2026-10-25)**: users `?view=xid` の `icon_url` は MIG-0635 では **記録した差（常に null）** とする。MIG-0511（公開 X icon map の projection、別 agent が起案中）が DONE になったら、lead が MIG-0705 か新 task に「projection から icon を読む」unit を足す。理由: CURRENT の `loadPublicXIconMapOptional` は最大 8 MiB の R2 map で S2 に入らない。MIG-0511 を MIG-0635 の依存にすると admin read 全体が止まる。
- **D-13-50 (owner-delegate, 2026-10-25)**: `users/[id]/edit` の初期値（user 1 行 + `getLinkedXUserIdsForAuthUser`。page 65 行）は MIG-0705 ではなく MIG-0635 に入れる（lead 案からの変更）。理由: MIG-0705 は R-SCREEN / Runtime N で API endpoint を持たない。読みは2文で S2 に収まる。
- **D-13-51 (owner-delegate, 2026-10-25)**: MIG-0626 の deep health（`/admin/health?deep=1|run=1`、22 check）は B job にせず、integrity と同じく **1 request = 1 check** の endpoint にする（`GET /api/admin-read/ops/health/checks/:checkId`、`GET /api/admin-read/ops/integrity/:checkId`）。`src/lib/admin/healthChecks.ts` と `integrityChecks.ts`（+ `permissionIntegrityChecks.ts`）は drizzle の check 関数なので server-core へ移し（R-CORE、bridge）、`dbMiddleware` の drizzle handle で1つずつ呼ぶ。理由: B job には結果を置く新しい table か KV key と cron が要り、どちらも owner の production 操作。CURRENT も page 表示時に同期実行している。`checkLikeCountDrift`（`healthChecks.ts:304`、like 付き動画を全件 JS に読む）は CURRENT のまま移し、MIG-0606 で warm max を測る（7ms 以上なら SQL 集計化を担当 unit で行う）。
- **D-13-52 (owner-delegate, 2026-10-25)**: `/admin/static-builds` の shared-input diagnostics（`src/lib/admin/staticSharedInputDiagnostics.ts:52`）は MIG-0626 から外し、MIG-0627 の DONE checklist に1行足す。MIG-0626 の DONE は「Admin 45 のうちこの1面を除く」。
- **D-13-53 (owner-delegate, 2026-10-25)**: core `updateAuditLogSettings(db, userId, patch)`（`packages/server-core/src/audit/settings.ts:45`）に省略可能な第4引数 `preloaded?: PreloadedAuditContext` を足し、`mutateWithAudit` に渡す。Next は何も渡さない（MIG-0617 L3 と同じ形）。理由: 無いと guard 2 + before 1 + 監査準備 2 = 5 読みで S3 を超える。
- **D-13-54 (owner-delegate, 2026-10-25)**: SA-010 dry run は core `restoreAuditLog(db, opts, host)`（`restore.ts:174`。host は必須引数）に「全メソッドが `audit_dry_run_host_unused` を throw する host」を渡す。dry run は host を使う前に return する（`restore.ts:218,262,312,359,413` の `dry_run` 分岐、host 使用は 490 行以降）。test で host が呼ばれないことを固定する。D1 文数は guard 2 + core 4（user role、log、prior success、`adapter.fetchCurrent`）= 6 で S3 を超えるが、書き込み 0・admin 専用・core（Next と共有）を変えないため記録した例外。応答は CURRENT の `{ok, message?, diff?}` を全件 200 で返し、400 は入力 schema の失敗だけ。
- **D-13-55 (owner-delegate, 2026-10-25)**: URL は `POST /api/admin/audit/settings`（SA-009）と `POST /api/admin/audit/dry-run`（SA-010）。body は CURRENT の FormData の key をそのまま JSON にする（`settingsPatchSchema` の5項目、`dryRunSchema` の `audit_id` / `reason`。`src/lib/actions/audit-admin.ts:31-37,77-80`）。
- **D-13-56 (owner-delegate, 2026-10-25)**: MIG-0605 の残りを分ける。MIG-0636 = Personal X / Active X / 規約（SA-074〜076, SA-098〜105）、MIG-0637 = admin 運用の書き込み + X merge admin（SA-016〜020, SA-045〜055, SA-069〜073, SA-077〜081, SA-092〜097, SA-106, SA-110）、MIG-0638 = MIG-0605 の残り Route Handler（RH-002, RH-004〜008, RH-019, RH-023〜025, RH-027/028）。親 MIG-0605 に残すのは SA-090/091（`canManageXIdLinkRequests` = `src/lib/auth/ownership.ts:174`、MIG-0633 の範囲）、D-03 fan-out dry-run、D-04 checkpoint、U07、Final audit で、MIG-0633 待ちの BLOCKED。SA-043/044 は MIG-0603（D-13-40）。
- **D-13-57 (owner-delegate, 2026-10-25)**: G21（body size 上限表 + middleware）は MIG-0636 が作る（最初の利用者が SA-105 `uploadXIdIcon` 8MB）。置き場所は `apps/api/src/middleware/bodyLimit.ts`。MIG-0603 の SA-086〜089 は同じ middleware を使う。
- **D-13-58 (owner-delegate, 2026-10-25)**: MIG-0606 の依存は計測する API の task 全部（MIG-0603, 0604, 0605, 0626, 0629, 0634〜0638）。MIG-0632 は MIG-0606 に依存するので入れない（循環）。RH-013 の CPU は MIG-0632 自身が測る（MIG-0632 Work Order の「上限入力の max CPU」）。
- **D-13-59 (owner-delegate, 2026-10-25)**: RH-017 `/api/health/deep` の検査本体（`apps/api/src/routes/health.ts:65-77` は fail-closed の仮実装）に担当 task が無い。MIG-0607 の DONE checklist が要求するので MIG-0626 U07 に入れる（`src/lib/health/deepHealth.ts` 448 行を server-core へ）。
- **D-13-60 (owner-delegate, 2026-10-25)**: `maybeMarkOnboardingComplete`（MIG-0611 からの引き継ぎ）の明示 POST（`POST /api/personal/onboarding/complete`）は MIG-0636 U03 に入れる。MIG-0702 は SPA から呼ぶだけ。理由: MIG-0702 は R-SCREEN で API を持たない。

## D-14 — 依存の見直しと大きい READY task の分割で、着手できる task をさらに増やす（DECIDED、2026-10-25）

決定者: Claude Opus（owner-delegate）2026-10-25。Yugo の standing instruction「判断は推奨案で進め、事後に報告」と、2026-10-25 の依頼「また次の 20 タスクくらいを実装開始可能な状態にして」に基づく。Fable は使っていない（2026-10-25 Yugo「fable使用禁止」）。Yugo には事後に伝える。本番操作（Remote D1・secret・Queue / Route 作成・deploy）は決めていない（各 Work Order の STOP）。前提: main `dde6fa8`、open PR は #401（MIG-0634）と #386 だけ。

依存の見直し（依存先の task が実際には要らないもの）:

- **D-14-1**: MIG-0609 の依存 MIG-0606 を外す。理由: MIG-0609 の待ち条件は「MIG-0606 の計測 script が merge された後」で、harness は #341（`77f65d69`、`scripts/benchmark-api-cpu.mjs`）で main にある。MIG-0606 の残り（U02）が待つのは API task で、背景処理の計測とは無関係。計測は LOCAL（`wrangler dev --local --test-scheduled`、workerd、inspector profiler）で、値は本番値と書かない。Linux host で BASELINE（何もしない handler）の max を同じ run で記録し、noise を数値で残す（MIG-0606 work item の Windows 雑音の教訓）。
- **D-14-2**: MIG-0632 の依存 MIG-0606 を外し MIG-0614 だけにする。理由: D-13-58 で RH-013 の CPU は MIG-0632 自身が測ると決まっており、必要なのは merge 済みの harness だけ。export cache key（`eventExportPayloadCacheKey` / `EVENT_EXPORT_REFRESH_MINUTES`、`src/lib/api/eventExportCache.ts:9,23`）の core 側の置き場所 `packages/server-core/src/publicCache/eventExportKeys.ts` は MIG-0603 U02a と共有で、先に merge した方が CURRENT の値をそのまま作り、後の方は import するだけ。
- **D-14-3**: MIG-0628 の依存 MIG-0606 を外し MIG-0405 だけにする。`apps/ops/wrangler.toml` は MIG-0704 U01 へ移す（`apps/ops` は MIG-0704 が作る。D-13-4 と同じ理由）。smoke list は手書きせず `ROUTE_MATRIX.md` / `API_MATRIX.md` の Hono 列から作る script と、その一覧に無い DONE route を落とす検査にする。MIG-0805 が cutover 前に同じ検査を再実行する。理由: binding 表・wrangler file・`wrangler deploy --dry-run` は API の CPU 測定を待つ理由が無い。
- **D-14-4**: MIG-0621 の依存 MIG-0509 を MIG-0409（DONE）に替える。理由: sitemap の入力（`snapshot/event-index/current.json`、`snapshot/users-index/current.json`、manifest）は #354 の `produceSnapshots.ts` が既に作る（`produceSnapshots.ts:275,325-328,339`）。MIG-0509 の残り（D1 REST、trending、build entry）は sitemap と無関係。決めたこと: (a) 動画 URL は CURRENT と同じ「recent の 1 ページ目 500 件」（`sitemapSources.ts:75-77` `normalizeStaticRecentVideoPage(recent, 1, 500)`）。`produceSnapshots.ts` に `snapshot/sitemap/videos.json`（`list/recent.json` の先頭 500 件の `id` / `youtube_video_id` / `scheduled_time`）を 1 key 足す。全公開動画（manifest の video-detail key）には広げない（URL 集合の parity）。(b) creator は users index だけを使う。CURRENT の search-index fallback（`sitemapSources.ts:126-142`）は users index が無いときの R2 劣化経路で、build は users index を必ず作る（`produceSnapshots.ts:275`）。無ければ creator 0 件 + build warning。(c) `lastModified` が無い entry は CURRENT の `new Date()`（request 時刻）の代わりに build 時刻。(d) robots の host / sitemap は `pageHead.ts:11` `siteOrigin()`。
- **D-14-5**: MIG-0802 の依存 MIG-0607（Phase 6 Gate）を MIG-0608（DONE）に替える（MIG-0801 は残す）。理由: PoC は非本番で、必要なのは MIG-0801 の baseline と MIG-0608 の Hono session 読み取りだけ。Phase 6 の API が揃うことは cookie / CSRF 互換の確認に関係しない。本番 cutover（MIG-0805）は従来どおり MIG-0804 と MIG-0628 の後で、Phase 8 Gate は Yugo の承認事項のまま。`@auth/core` は `next-auth@5.0.0-beta.32` が使う版と同じ `0.41.3` に固定する（`package-lock.json` の `node_modules/next-auth` の dependencies）。
- **D-14-6**: MIG-0507 の依存 MIG-0511 を外す。理由: `/[id]` のアイコン投影の確認は MIG-0511 T03（`buildVideoPages` に map を渡す test）が持ち、MIG-0507 の残り（U10 playlist、U11 audit、U12 browser）は map を使わない。DONE checklist の「MIG-0511 のアイコン projection が `/[id]` に入っている」は MIG-0508（Phase 5 Gate）の checklist へ移す。`videoPage.ts` は両 task が触るので、後に merge する方が rebase する。

分割（同時に着手できる単位にする。親の依存は変えない）:

- **D-14-7**: MIG-0606 U02 の前半を MIG-0639 に切り出す。main にある Hono endpoint（MIG-0601 / 0602 / 0611 / 0617 / 0623 / 0624 / 0625 / 0630 / 0631 と RH-014 / RH-020..022 / SA-012..015 / SA-036）を Linux host で測る。D-12 の「live slots 6000 枠の warm max が 7ms 以上なら additive paging」と MIG-0631 T17（RH-012 500 動画 × 100 member）の判定をここで出す。MIG-0606 は残りの endpoint と最終表を持ち、MIG-0639 に依存する。MIG-0604 も MIG-0639 に依存する（STATUS と Work Order の依存で強制。#404 review 指摘）。理由: 超過の早期発見（SA-007/008 の実例が MIG-0606 work item にある）と、D-12 の判定を MIG-0604 の U04 より前に出すため。
- **D-14-8**: MIG-0603 U03a（SA-087 like / bookmark）を MIG-0640 に切り出す。依存 MIG-0602。MIG-0603 は U02a / U02b / U02c / U03b / U03c と Final audit。
- **D-14-9**: MIG-0636 U03（SA-074..076 と onboarding complete の POST）を MIG-0641 に切り出す。依存 MIG-0602。MIG-0702 は MIG-0641 にも依存する（U03 onboarding）。body 上限は MIG-0641 では使わない（規約の body は form field 2 つ）。
- **D-14-10**: MIG-0637 を4つに分ける。MIG-0637 = U01（自分の SA の表）+ cost guard SA-016..020 + user admin SA-077..081。MIG-0642 = terms versions SA-051..055 + editable fields SA-049 + notifications SA-045..048。MIG-0643 = static rebuild admin SA-069..073 + youtube resync SA-106 + visibility repair SA-050。MIG-0644 = X merge admin SA-092..097 + SA-110（依存 MIG-0602, MIG-0618）。contracts は task ごとに別 file（`packages/contracts/src/admin/{ops,termsNotifications,staticRebuildOps,xidMerges}.ts`）。`apps/api/src/routes/admin/index.ts` と `packages/contracts/src/admin/index.ts` は各 task が 1 行ずつ足し、rebase の衝突は両方の行を残して解く。
- **D-14-11**: MIG-0638 を5つに分ける。MIG-0638 = spreadsheet 書き込み / import（RH-004..008、F-1 / F-5。Routing 条件もここ）。MIG-0645 = legacy import RH-002。MIG-0646 = media RH-023..025。MIG-0647 = public event staff RH-027 / 028。MIG-0648 = X-user search RH-019。全部の依存は MIG-0602, MIG-0631。
- **D-14-12**: MIG-0510 を4つに分ける。MIG-0510 = U01 `/list` + top search band（依存 MIG-0634）。MIG-0513 = `/[id]` の操作（依存 MIG-0603, MIG-0634, MIG-0640）。MIG-0514 = `/event/[id]/slots` の予約（依存 MIG-0604）。MIG-0515 = `/rules` 同意 + header の Active X 切替（依存 MIG-0636, MIG-0641）。D-13-24 の「unit ごとに API の DONE を待つ」を STATUS の依存で表す。
- **D-14-13**: MIG-0627 U01（R2 artifact の読み手の棚卸し）を MIG-0649 に切り出す。依存なし。成果は `R2_ARTIFACT_CONSUMERS.md` と、表に無い R2 key の読み手を CI で落とす `scripts/check-r2-artifact-consumers.mjs`。MIG-0627 は MIG-0509 と MIG-0649 に依存する。
- **D-14-14**: 依存の付け替え: MIG-0606 → MIG-0603..0605, 0626, 0629, 0634..0648。MIG-0607 → MIG-0606, 0631, 0632, 0634..0648。MIG-0508 → MIG-0501..0507, 0509..0515, 0621, 0607。MIG-0702 → MIG-0602, 0636, 0641, 0701。MIG-0705 → 従来 + MIG-0642..0648。

着手できないまま残す task と理由（2026-10-25 時点）: MIG-0604 / MIG-0605（MIG-0633 の core 待ち）、MIG-0606 / 0609 以外の計測後続（MIG-0610 は MIG-0609 の表待ち）、MIG-0410（owner の本番手順）、MIG-0627（MIG-0509 の build 経路待ち）、MIG-0702..0705（MIG-0701 の SPA 待ち）、MIG-0803..0805（MIG-0802 待ち）、Phase 9（各 Gate 待ち）、MIG-0513 / 0514 / 0515（API 待ち）。

## D-15 — MIG-0633 の DONE を受けて書き込み API を分割し、着手できる task をさらに増やす（DECIDED、2026-10-26）

決定者: Claude Opus（owner-delegate）2026-10-26 JST。Yugo の standing instruction「判断は推奨案で進め、事後に報告」と、2026-10-26 の依頼「また次の20タスクくらいを実装開始可能な状態にして」に基づく。Fable は使っていない（Yugo「fable使用禁止」）。本番操作（Remote D1・secret・deploy・Route・Queue binding）は従来どおり作業直前の明示承認。基準 commit は main `0a0f62a`（#407 の後）。

状態の修正:

- **D-15-0**: MIG-0605 を READY と書く。STATUS の行は既に READY だったが、Work Order の Readiness が「BLOCKED（MIG-0633 待ち）」のままだった。MIG-0633 は #402（`15f41ce`）で DONE。同じ理由で MIG-0603 の U02c（SA-040..042）の待ち条件を「MIG-0633」から「U02a の host」に直した（`manage-video.ts` は U02a の `videoTransitionHost.ts` を使う）。

分割（同時に着手できる単位にする）:

- **D-15-1**: MIG-0603 U03b（SA-082..085、共同編集者 / member）を MIG-0650、U03c（SA-086 / 088 / 089、投稿・更新）を MIG-0651 に切り出す。依存は MIG-0602, MIG-0633。U03c は旧 Work Order にも「別 MIG 推奨」とあった。MIG-0603 は U02a / U02b / U02c と Final audit。
- **D-15-2**: `loadVideoRebuildEventIds`（`src/lib/video/videoVisibilityStatusCore.ts:15`、36 行）の core の置き場所を `packages/server-core/src/video/rebuildEventIds.ts` に決める。理由: MIG-0603 U02a と MIG-0650（`video-collab-perms.ts:45`、`adminMembers.ts:25`）の両方が使い、U02a の `visibilityStatusAction.ts` に入れると MIG-0650 が U02a を待つことになる。先に merge した方が作り、後の方は import だけ。
- **D-15-3**: `apps/api/src/middleware/bodyLimit.ts` は MIG-0636 U01 の仕様（SA ごとの上限表、Content-Length と実読み byte の両方、413）のまま、MIG-0636 と MIG-0651 のうち先に merge した方が作る。後の方は上限表に自分の行を足すだけ。D-14 の `eventExportKeys.ts`（D-14-2）と同じ扱い。
- **D-15-4**: MIG-0604 U04 を6つに分ける。MIG-0652 = SA-021..024（作成・更新・削除・ID 変更、可視性 fence あり）、MIG-0653 = SA-025..030（group、admin 専用）、MIG-0654 = SA-031..034（staff・owner 移譲、owner 0 guard）、MIG-0655 = SA-035 / 037..039（template の保存・一覧、playlist 設定）、MIG-0656 = SA-056..064（枠の運営操作）、MIG-0657 = SA-065..068（予約・解放・延長・統合）。依存は全て MIG-0602, MIG-0305, MIG-0633。**MIG-0639 は待たない**: MIG-0639 が出す D-12 の判定は RH-020 live slots（読み、#334 で merge 済み）の 6000 枠に additive paging が要るかどうかで、書き込みの SA には関係しない（`work-items/MIG-0604.md` Exceptions、`PHASE_6_SPEC.md` MIG-0604「記録した既知の差・例外」）。MIG-0604 は Final audit と、判定が「要る」ときだけの U05 paging を持ち、MIG-0639 と MIG-0652〜0657 に依存する。MIG-0514 の依存は MIG-0604 から MIG-0657 に替える。
- **D-15-5**: event の可視性遷移の Hono host は `apps/api/src/visibility/eventTransitionHost.ts` に作る（MIG-0652）。形は MIG-0603 U02a の `videoTransitionHost.ts` と同じ（core の manifest read / CAS put、`deletePublicJsonCaches`、通知 builder、wake は何もしない）。両者は別 file なので並行できる。
- **D-15-6**: SA-039（playlist sync 要求）の Queue wake は 0 にする（D-0603-1 / D-13-41 と同じ扱い）。sync 要求の D1 行は CURRENT と同じ batch に書き、回収は sync-jobs の cron `7,52 * * * *`（`workers/sync-jobs/wrangler.toml:12`、`workers/sync-jobs/index.ts:278`）で最悪約 45 分。理由: `apps/api` に Queue binding が無い。Phase 7 の UI 切替で owner が遅れを拒否したら binding を MIG-0628 で再検討（Yugo の明示承認事項）。
- **D-15-7**: MIG-0605 U05d（D-03 fan-out の dry-run script）を MIG-0658 に切り出す。依存なし（local の migration 済み DB だけ、Remote D1 を読まない）。MIG-0605 は U05x（SA-090/091）、U05e（D-04 checkpoint）、U07、Final audit。
- **D-15-8**: MIG-0636 U04（SA-099..101、X 連携申請・取り消し・merge 取り消し申請）を MIG-0659 に切り出す。依存 MIG-0602。`apps/api/src/routes/xid/index.ts` と `app.ts` の `/api/xid` mount は MIG-0636 と MIG-0659 のうち先に merge した方が作る。MIG-0702 は MIG-0659 にも依存する（U02 link 申請）。
- **D-15-9**: MIG-0626 U07（RH-017 deep health の検査本体を core へ）を MIG-0660 に切り出す。依存 MIG-0601。U05 / U06 は `adminRead/ops.ts` を共有するので MIG-0626 に残すが、U07 は `health.ts` と `src/lib/health/*` だけで重ならない。
- **D-15-10**: `/api/manage` の書き込みは既存の `manageRoutes`（`apps/api/src/routes/manage/index.ts`、MIG-0624 の読み専用 router）に、admin router（`apps/api/src/routes/admin/index.ts:37-47`）と同じ順の `onlyMutating` stack を足して載せる。具体的には (1) `sessionMiddleware()` の `use` の前に `manageRoutes.use("*", onlyMutating((c, next) => originGuardMiddleware(originOptions(c))(c, next)));`、(2) `requireAuth()` の後に `manageRoutes.use("*", onlyMutating((c, next) => writeGuardMiddleware({ ...originOptions(c), requiredRole: null })(c, next)));` と `manageRoutes.use("*", onlyMutating(dbMiddleware));`、(3) ファイル先頭の「nothing here writes」のコメントを「GET は書かない。書き込みは onlyMutating の stack を通る」に直す。`originOptions` は admin と同じ定義。GET の挙動は変わらない（`onlyMutating` が SAFE method を素通しする、`writeOrigin.ts:423-428`）。CostGuard は各 route module の中で feature ごと。`manageRoutes.onError` は全ての例外を 503 `unavailable` にするので、書き込み route は自分で例外を捕まえて CURRENT の文言を返す。理由: `/api/manage` に別の sub-app を重ねると `manageRoutes` の `use("*")` が二重に session を読む（`sessionMiddleware` は冪等ではない、`apps/api/src/auth/session.ts:365`）。これを最初に入れるのは MIG-0603 U02c / 0652 / 0654 / 0655 / 0656 のうち先に merge した task で、後の task は route 1 行だけ。user 向けの枠予約（MIG-0657）は `/api/events` に `viewerOverlay.ts:194-200` と同じく path を指定した stack で載せる（`events/index.ts` は `/api/admin` の admin 専用 router なので使わない）。
- **D-15-11**: MIG-0509 U05（`public_build_state.requested_at` の mark）を MIG-0516、U06（GA4 同期の入力を D1 へ）を MIG-0517 に切り出す。依存は MIG-0409。理由: どちらも U01〜U03（`produceSnapshots.ts` / `buildPublicSite.ts`）と file が重ならない。MIG-0516 の merge は従来どおり owner の read-only 確認（本番 D1 で 0065 が applied）の後（MIG-0509 STOP 3）。
- **D-15-12**: MIG-0513 から API が merge 済みの部分（U02 chapter composer + コメント、SA-012..015 は #393。U04 `?playlist=` dock と overlay の client、RH-031 は MIG-0634 #401）を MIG-0518 に切り出す。依存 MIG-0407, MIG-0634。MIG-0513 は like / bookmark（MIG-0640）と状態 form（MIG-0603）で、MIG-0518 の overlay client を使うので MIG-0518 にも依存する。
- **D-15-13**: MIG-0704 U01 の Ops SPA の土台（`apps/ops` の package・build・router 枠・guard・noindex・`_headers`、CI）を MIG-0707 に切り出す。依存 MIG-0102, MIG-0608, MIG-0624, MIG-0625。guard は RH-001 `GET /api/account/summary` の `canAccessAdmin` / `canAccessManage`（`account/summary.ts:282-302`）で CURRENT の layout と同じ Location を返す。`CostGuardBanner` は読む HTTP endpoint が main に無いので MIG-0704 に残す。`apps/ops/wrangler.toml` も D-14-3 のとおり MIG-0704。
- **D-15-14**: MIG-0901 のうち本番ログが要らない code 側の棚卸し（4 つの `wrangler.toml` の Worker・Cron・Queue・binding の表と CI の検査）を MIG-0908 に切り出す。依存なし。本番の観測（旧 Worker へのリクエスト）は MIG-0901 に残し、MIG-0901 は MIG-0908 にも依存する。`/dev/ui-surfaces` の行き先は案だけ書き、決定は MIG-0901 の Gate で人間がする。
- **D-15-15**: 依存の付け替え: MIG-0606 → 従来 + MIG-0650..0657, 0659, 0660。MIG-0607 → 従来 + MIG-0650..0660。MIG-0508 → MIG-0501..0507, 0509..0518, 0621, 0607。MIG-0703 → MIG-0603, 0650, 0651, 0657, 0702, 0623, 0630（MIG-0604 を外す）。MIG-0704 → 従来 + MIG-0707。MIG-0705 → 従来 + MIG-0650..0657, 0660。MIG-0639 は D-14 の後に main に入った MIG-0629 / 0634 / 0635 の endpoint も測る（T01「main にある全 Hono method」の範囲の確認）。

見送ったもの（着手できる単位にしなかった理由）: MIG-0603 U02c（U02a の host を使う）、MIG-0410（owner の本番手順だけ）、MIG-0610（MIG-0609 の表待ち）、MIG-0627（MIG-0509 の build 経路待ち）、MIG-0702..0705 の画面（API と MIG-0701 / 0707 の DONE 待ち）、MIG-0803..0805（MIG-0802 待ち）、MIG-0637 / 0642 / 0643 の再分割（1 task が 5〜9 SA で parity test を共有しており、分けても並行の利点が小さい）、API CPU benchmark の新しい part（MIG-0639 が「main にある全 method」を測るので重複）。

## D-16 — API 待ちの画面・Island を契約先行で着手できるようにする（DECIDED、2026-10-26）

決定者: Claude Opus（owner-delegate）2026-10-26 JST。Yugo の standing instruction「判断は推奨案で進め、事後に報告」と、2026-10-26 の依頼「また次の20タスクくらいを実装開始可能な状態にして」に基づく。Fable は使っていない（Yugo「fable使用禁止」）。基準 commit は main `c2a6ecb`（#411 の後）。

状況: D-15 の後、READY は約 50 件ある。BLOCKED の残り約 25 件のうち、Gate（0508 / 0607 / 0706 / 0806 / 0906）、本番の観測・操作（0410 / 0805 / 0901〜0907）、測定待ち（0610 ← 0609、0627 ← 0509）、MIG-0802 待ち（0803〜0805）は分けても着手できない。残る大きな塊は「Phase 6 の書き込み API を待つ公開 Island（0513〜0515）と Personal SPA の画面（0702 / 0703）」で、待っている理由は API の **merge** であって API の **形** ではない（method と path は各 API の Work Order が既に決めている）。

方式:

- **D-16-1（契約先行と Merge gate）**: 画面・Island の task は、呼ぶ API の task が DONE になる前に着手してよい。その API task は STATUS の Depends on に書かず、Work Order の `**Merge gate:**` 行に書く。HTTP 契約は次のとおりで、API task もこれに従う（各 API の Work Order の Decisions に D-16-1 を足した）。
  1. method と path: API の Work Order に書いてあるもの。
  2. request body: CURRENT の Server Action が受ける FormData / 引数の key をそのまま JSON の key にする（例: SA-098 `{ "x_user_id": "..." }`、SA-103 `{ "x_user_id", "confirm" }`）。path に id がある API は path の値が正で、body の同じ key は送らない。file を含みうる SA（SA-105 の `icon_file`、SA-086 / 088 / 089 の投稿 form。`VideoForm.tsx:442` は form 全体を `new FormData(form)` にし、icon の upload file を含む）は JSON にせず multipart で、CURRENT の FormData の key と値をそのまま送る。
  3. response body: CURRENT の Server Action が返す結果 object をそのまま JSON にする（`{ ok: true, ... }` / `{ ok: false, message }`）。status は R-API のとおり 200 と 400 / 403 / 404 / 409 / 413（失敗も同じ形の body）。401 は未ログイン。
  4. 画面側は API が merge されるまで、client file の中に暫定の型を書き、1 行目に `// D-16-1 provisional: replace with @flamenode/contracts at merge` と書く。test の fixture は暫定の型で作る。
  5. merge の直前に、gate の task が DONE になった main を取り込み、暫定の型を API task が作った `packages/contracts` の schema の import に置き換え、test の fixture をその schema の `parse` に通す（`apps/app/test/helpers.mjs:19-24` と同じ形）。schema と合わない差が出たら STOP して API task に返す（画面側で吸収しない）。
  6. CI: Merge gate を持つ task は下の表（機械可読の台帳）に書く。`scripts/check-migration-task-cards.mjs` の `validatePlanCompleteness` はこの表を正として、gate の task が DONE でないのに画面側を DONE にした STATUS を失敗にする。Work Order を消しても `**Merge gate:**` 行を消しても、表の行が残る限り検査は外れない。DONE・SKIPPED になっていない task は、Work Order の `**Merge gate:**` 行と表の行が一致しないと失敗する（行が無い、表に無い、MIG が違う）。SKIPPED は gate を待たない（SKIPPED は別の承認で決まり、画面は作らない）。表の行を消すのは D-16-1 の決定を変えることなので、OPEN_DECISIONS の変更として理由を書く。test は `scripts/check-migration-task-cards.test.mjs`。
  <!-- merge-gates:start -->

  | Task | Merge gate |
  | --- | --- |
  | MIG-0513 | MIG-0640 |
  | MIG-0514 | MIG-0657 |
  | MIG-0515 | MIG-0636 |
  | MIG-0519 | MIG-0641 |
  | MIG-0708 | MIG-0636 |
  | MIG-0709 | MIG-0659 |
  | MIG-0710 | MIG-0641 |
  | MIG-0715 | MIG-0650 |
  | MIG-0716 | MIG-0648, MIG-0650, MIG-0651 |
  | MIG-0717 | MIG-0648, MIG-0650, MIG-0651 |
  | MIG-0707 | MIG-0664 |
  | MIG-0718 | MIG-0661, MIG-0701 |
  | MIG-0719 | MIG-0707, MIG-0661, MIG-0628, MIG-0663 |
  | MIG-0720 | MIG-0707, MIG-0719, MIG-0655 |
  | MIG-0721 | MIG-0707, MIG-0719, MIG-0726, MIG-0652 |
  | MIG-0722 | MIG-0707, MIG-0719, MIG-0656 |
  | MIG-0723 | MIG-0707, MIG-0719, MIG-0654 |
  | MIG-0724 | MIG-0707, MIG-0719, MIG-0603 |
  | MIG-0725 | MIG-0707, MIG-0719, MIG-0655, MIG-0605 |
  | MIG-0726 | MIG-0707, MIG-0661 |
  | MIG-0727 | MIG-0707, MIG-0726, MIG-0642 |
  | MIG-0728 | MIG-0707, MIG-0726, MIG-0653 |
  | MIG-0729 | MIG-0707, MIG-0726, MIG-0603 |
  | MIG-0730 | MIG-0707, MIG-0726, MIG-0650, MIG-0648 |
  | MIG-0731 | MIG-0707, MIG-0726, MIG-0637, MIG-0642, MIG-0603 |
  | MIG-0732 | MIG-0707, MIG-0726, MIG-0605, MIG-0644 |
  | MIG-0733 | MIG-0707, MIG-0726, MIG-0662 |
  | MIG-0734 | MIG-0707, MIG-0726, MIG-0637, MIG-0642 |
  | MIG-0735 | MIG-0707, MIG-0726, MIG-0643 |
  | MIG-0736 | MIG-0707, MIG-0726, MIG-0626 |
  | MIG-0737 | MIG-0707, MIG-0726, MIG-0638, MIG-0645 |

  <!-- merge-gates:end -->
  理由: 待っているのは merge 順だけで、契約の決め方（CURRENT の入力 key と結果 object を変えない）は R-API と各 API の Work Order が既に決めている。API と画面を同時に作れば、Phase 5 / 7 の画面が API の後に直列で並ばない。危険は契約のずれで、5 の置き換えと schema の parse で merge 前に必ず検出される。
- **D-16-2（Personal SPA の書き込み client）**: `apps/app/src/api/write.ts` を作る（MIG-0708 / 0709 / 0710 / 0715 のうち先に merge した方が作り、後の方は import だけ）。中身は `export async function send<T extends { ok: boolean }>(fetchFn, method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: object | FormData): Promise<{ status: "ok"; data: T } | { status: "anonymous" } | { status: "unavailable" }>`。`credentials: "same-origin"`、`cache: "no-store"`、`accept: application/json`、body が FormData でなければ `content-type: application/json`。応答の JSON に boolean の `ok` があれば status に関係なく `{status:"ok", data}`、401 で `ok` が無ければ `anonymous`、それ以外（network 失敗・JSON でない）は `unavailable`。画面は `unavailable` のとき CURRENT の catch の文言（各 component の「〜に失敗しました。」）を出す。各 task の client は `apps/app/src/api/<name>.ts` に `create<Name>Api(fetchFn)` として作り、`PersonalApi`（`apps/app/src/api/personal.ts:43-49`）に 1 行（例 `xidProfile: XidProfileApi;`）、`createPersonalApi` に 1 行足す。
- **D-16-3（`router.refresh()` の置き換え）**: CURRENT の component は成功後に `router.refresh()` する。SPA では `useApiResult`（`apps/app/src/routes/guard.tsx:116-137`）に 4 番目の引数 `refreshKey = 0` を足し、`refreshKey` だけが変わったときは `LOADING` にせず、成功なら data を差し替え、失敗なら前の data を残す（画面が一瞬消えて入力中の message が失われるのを防ぐ）。先に merge した task が足す（MIG-0708 の Micro-units に code）。`router.push(next)` は `useNavigate()(next)`（SPA 内）か `window.location.assign(next)`（SPA 外、D-05）。
- **D-16-4（共有の leaf component）**: Personal SPA の 2 task 以上が使う CURRENT の部品は `apps/app/src/components/shared/` に 1 回だけ移植する。`SocialLinksEditor.tsx`（`src/components/forms/SocialLinksEditor.tsx`、127 行）、`YoutubeChannelPicker.tsx`（`src/components/settings/YoutubeChannelPicker.tsx`、259 行）、`SquareIconEditor.tsx` + `SquareIconEditorBoundary.tsx`（`src/components/media/`、388 + 52 行）、`ConfirmDialog.tsx`（`src/components/ui/ConfirmDialog.tsx`、139 行）。MIG-0708 と MIG-0712 のうち先に merge した方が作る（後の方は import だけ）。CSS module は MIG-0701 U04b の `apps/app/scripts/portCssModule.mjs` の `MODULES` に行を足して生成する（`portCssModule.mjs` が main に無ければ MIG-0701 U04b の内容のまま作る）。`Icon` は既存の `apps/app/src/routes/ui/Icon.tsx` を使う。X ID の parse（`parseXIdentityInput` / `normalizeXId` / `parseCanonicalXId`）は CURRENT と同じ `@flamenode/domain/xid`（`src/lib/utils/xid.ts:1-6` が re-export）を import し、`apps/app/package.json` に `@flamenode/domain` を足す（最初に要った task が足す）。公開 Island の guard の移動先（CURRENT `src/lib/client/guardRedirect.ts`、48 行）は `apps/site/src/lib/guardRedirect.ts` に、Personal SPA 用は `apps/app/src/lib/guardRedirect.ts` に、それぞれ最初に要った task が同じ中身で作る。
- **D-16-5（MIG-0513 の範囲）**: CURRENT の公開 `/[id]` は状態 form を出さない。`VideoStatusForm` の呼び出し元は `app/(manage)/manage/events/[id]/videos/[videoId]/page.tsx:13,97`（`ManageVideoStatusForm`）と `app/(admin)/admin/videos/[id]/page.tsx:10,103`（`AdminVideoStatusForm`）だけで、`app/(public)/[id]/page.tsx:403` は `VideoInteractionActions`（like / bookmark）だけ。旧 MIG-0513 U03（状態 form）は Ops SPA の video 詳細画面（MIG-0704 / 0705）に属するので削る。MIG-0513 は like / bookmark だけになり、依存は MIG-0407, MIG-0634、Merge gate は MIG-0640。
- **D-16-6（like と Active X）**: CURRENT の like / bookmark は Active X を要らない（`src/lib/actions/video/interaction.ts:61` `requireActiveXId: false`、`InteractionButton.tsx:16-19` のコメント）。CURRENT に「X 0件でいいね → 誘導モーダル」の component は無い（`ActiveXLinkModal` / 類似名は `src/`・`app/` に0件）。旧 MIG-0513 T01 の「Active X 0件 / 複数 → 403 / 202 / modal」と旧 MIG-0702 T04・Owned path の `ActiveXLinkModal.tsx` は code と食い違うので削る（code に従う）。
- **D-16-7（viewer overlay client の作り手）**: `apps/site/src/lib/viewerOverlay.ts`（RH-031 の client、MIG-0518 U01 の仕様）は MIG-0518 と MIG-0513 のうち先に merge した方が作る。MIG-0513 は MIG-0518 に依存しない。

分割:

- **D-16-8**: MIG-0515 U01（`/rules` の同意 form、SA-075）を MIG-0519 に切り出す。Merge gate MIG-0641。MIG-0515 は header の Active X 切替（SA-098）だけで、Merge gate MIG-0636。どちらも依存は MIG-0407。
- **D-16-9**: MIG-0514 は分けずに READY にする（依存 MIG-0407、Merge gate MIG-0657）。viewer panel（RH-014、#391 で merge 済み）と予約 control は同じ `SlotGrid` の state を使い、分けると同じ file を 2 task が書く。
- **D-16-10**: MIG-0702 を CURRENT の component の境目で 3 つに分ける。MIG-0708 = `XIdSettingsClient.tsx` の `SetActiveXButton`（:243、SA-098）・`XIdCompactProfileForm`（:294、SA-102）・`XIdIconPicker`（:439、SA-104 / 105）・`DeleteXIdForm`（:650、SA-103）、Merge gate MIG-0636。MIG-0709 = `XIdLinkForm`（:16）・`XIdMergeForm`（:111）（SA-099）・`XIdLinkedList.tsx`（:125 SA-100、:150 SA-101）・`app/(auth)/onboarding/OnboardingXIdForm.tsx`（SA-099）、Merge gate MIG-0659。MIG-0710 = `OnboardingTermsForm.tsx`（SA-076）と `/onboarding` 到達時の `POST /api/personal/onboarding/complete`（MIG-0611 の引き継ぎ）、Merge gate MIG-0641。MIG-0702 は Final audit だけで、依存は MIG-0708..0710。
- **D-16-11**: MIG-0703 を分ける。MIG-0711 = `/entry`（読みは MIG-0623 の `GET /api/personal/entry`、書き込み無し）。MIG-0712 / 0713 / 0714 = 投稿 form の移植（A: 小さい field 部品、B: `VideoMembersField`、C: `VideoForm` 本体と `UnslottedPostForm`。C は A と B に依存）。部品の中で network を呼ばず、submit・X user 検索（RH-019）・権限一括（SA-084）は props の adapter で受ける。MIG-0715 = `/dashboard/edit/:id/permissions`（`VideoCollabPermsManager`、SA-082..084、Merge gate MIG-0650）。MIG-0716 = `/entry/slotted` と `/entry/unslotted`（SA-088 / SA-086）、MIG-0717 = `/dashboard/edit/:id`（SA-089）。0716 / 0717 は MIG-0714 に依存し、Merge gate は MIG-0651（submit）・MIG-0648（RH-019）・MIG-0650（SA-084）。MIG-0703 は Final audit だけで、依存は MIG-0711, 0715..0717。
- **D-16-12（`/entry` の Discord ログイン）**: CURRENT `app/(auth)/entry/page.tsx:202-222` は server action の中で `signIn("discord", { redirectTo: entryLoginRedirectTo(next) })` を呼ぶ（SA-107 の一部）。SPA は server action を呼べないので、Auth.js の HTTP の流れを使う: `GET /api/auth/csrf` で `csrfToken` を得て、`<form method="POST" action="/api/auth/signin/discord">` に hidden の `csrfToken` と `callbackUrl = entryLoginRedirectTo(next)`（CURRENT `src/lib/auth/authComplete.ts:105-108`、`sanitizeNextPath(next, "/entry")` → `/auth/complete?...`）を入れて submit する。これは next-auth の client `signIn()` と同じ request で、endpoint は Phase 8 まで CURRENT の `app/api/auth/[...nextauth]/route.ts`。`GET /api/auth/csrf` が失敗したら `/entry?error=auth_temporarily_unavailable` へ移動する（CURRENT :211-213 と同じ移動先）。MIG-0802 が path を変える場合は MIG-0802 が `/entry` の form も直す。
- **D-16-13（CostGuardBanner の読み API）**: CURRENT の banner は `(auth)`・`(manage)` layout では公開 source（`resolveCostGuardBannerSnapshot`、KV mirror と env だけで D1 を読まない、`src/lib/operationMode/publicMode.ts:108-117`）、`(admin)` layout では admin source（D1 `system_settings`、`CostGuardBanner.tsx:57-67`）を読む。HTTP endpoint が main に無い（D-15-13）ので MIG-0661 で 2 本作る: `GET /api/operation-mode/banner`（session 無し、`resolvePublicOperationMode(c.env, { allowD1: false })` と KV mirror の reason、D1 0 文）と `GET /api/admin-read/cost-guard-banner`（既存の admin 読み router の guard の下、D1 1 文）。Personal SPA の banner は MIG-0718（Merge gate MIG-0661, MIG-0701）。D-13-6 は `(auth)` layout の header / footer / banner を lead follow-up FIX-0701-1 に送り、その理由の1つが「banner を返す Hono endpoint が無い」だった。endpoint を MIG-0661 で作るので、FIX-0701-1 のうち banner の部分を MIG-0718 として MIG にする（FIX-0701-1 には header / footer が残る。MIG-0706 Gate の checklist も同じ）。Ops の banner は従来どおり MIG-0704 / 0705 で、依存に MIG-0661 を足した。
- **D-16-14（MIG-0807）**: MIG-0804 U02（security）のうち、MIG-0802 を待たずに確かめられる部分（main にある `apps/api/src/auth/session.ts` の cookie 解決と `apps/api/src/middleware/writeOrigin.ts` の Origin / writeGuard、`adminReadGuard.ts`）を MIG-0807 に切り出す。依存 MIG-0602, MIG-0608。成果は `docs/migration/auth/SECURITY_REVIEW.md` の §1（MIG-0807 が作る）で、MIG-0804 は §2 に Auth.js 側を足す。MIG-0804 は MIG-0807 にも依存する。

依存の付け替え: MIG-0508 → MIG-0501..0507, 0509..0519, 0621, 0607。MIG-0606 → 従来 + MIG-0661。MIG-0607 → MIG-0606, 0631, 0632, 0634..0648, 0650..0661。MIG-0704 / 0705 → 従来 + MIG-0661。

見送ったもの: Ops SPA の画面（MIG-0704 / 0705。`apps/ops` が無いので MIG-0707 の merge まで着手できない）、MIG-0610（MIG-0609 の測定値が要る）、MIG-0627 U04 / U05（MIG-0509 の build 経路が要る）、MIG-0803〜0805（MIG-0802 の `authjs.ts` が要る）、Gate と本番の観測・操作。

## D-17 — Ops SPA の画面（Manage 12・Admin 45）を画面群に分けて契約先行で着手できるようにする（DECIDED、2026-10-27）

決定者: Claude Opus（owner-delegate）2026-10-27 JST。Yugo の standing instruction「判断は推奨案で進め、事後に報告」と、2026-10-26 の依頼「また次の20タスクくらいを実装開始可能な状態にして」に基づく。Fable は使っていない（Yugo「fable使用禁止」）。基準 commit は main `08e7e8c`（#415 の後）。

状況: D-16 の後、BLOCKED の大きな塊は Ops SPA の MIG-0704（Manage 12 画面）と MIG-0705（Admin 45 画面）だけで、どちらも 1 task のままでは 1 PR に収まらない。待っている理由は (a) `apps/ops` の土台（MIG-0707、READY、未着手）、(b) 書き込み API（Phase 6 の READY task 群）の merge で、読み API（MIG-0624 / 0625 / 0635 と account summary）は main にある（`apps/api/src/app.ts:30-31,46`）。画面ごとの CURRENT 部品・Server Action・読み endpoint は 2026-10-27 に code で確かめた（下の各 Work Order の Source snapshot）。

方式:

- **D-17-1（土台の Merge gate）**: Ops の画面 task は MIG-0707 を Depends on に書かず、`**Merge gate:**` に書く（D-16-1 の表に行を足す）。着手時に `apps/ops` が main に無ければ、PR の最初の commit で MIG-0707 の Work Order の U01〜U05 をその文面のとおりに作る（commit message `provisional MIG-0707 scaffold (D-17-1)`）。この暫定の土台の file は、`apps/ops/src/routes/router.tsx` に自分の route 行を足す以外は変えない。merge の直前に MIG-0707 が DONE の main を取り込み、MIG-0707 の Owned paths の file を `git checkout origin/main -- <path>` で main の版に戻し、自分の route 行だけを足し直して build と test を通す。MIG-0707 の版と食い違って自分の画面が動かないときは STOP して MIG-0707 に返す（画面側で土台を直さない）。Manage の画面（MIG-0720〜0725）は Manage の枠 MIG-0719 を、Admin の画面（MIG-0727〜0737）は Admin の枠 MIG-0726 を、同じ扱いの Merge gate にする（枠が無い間は MIG-0707 の route 枠の中に出る）。
- **D-17-2（Ops の読み client）**: `apps/ops/src/api/read.ts`（MIG-0707 U05 が作る）に `getJson<T>(fetchFn, path, signal): Promise<OpsResult<T>>` を置く。`OpsResult<T> = {status:"ok", data:T} | {status:"anonymous"} | {status:"forbidden", redirect?: string, reason?: string} | {status:"notFound"} | {status:"unsupported"} | {status:"unavailable"}`。写像は 200 → ok、401 → anonymous、403 → forbidden（body の `redirect` / `reason` をそのまま）、404 → notFound、501 → unsupported、それ以外・network 失敗・JSON でない → unavailable。`credentials: "same-origin"`、`cache: "no-store"`、`accept: application/json`（`apps/app/src/api/personal.ts:61-79` と同じ）。画面は anonymous → `/entry`、`/api/manage/*` の forbidden → `/dashboard`、`/api/admin-read/*` の forbidden → body の `redirect`（`/dashboard`）へ `window.location.assign`（CURRENT の layout の redirect、D-05）。notFound は CURRENT の `notFound()` と同じ 404 画面（MIG-0707 U05 の `NotFoundView`）。画面ごとの client は `apps/ops/src/api/<name>.ts` に `create<Name>Api(fetchFn)` として作る。
- **D-17-3（Ops の書き込み client と再取得）**: `apps/ops/src/api/write.ts` は D-16-2 の `send` と同じ signature・同じ写像で MIG-0707 U05 が作る。`useApiResult`（`apps/ops/src/routes/useApiResult.ts`）は D-16-3 の `refreshKey` 付きの形で MIG-0707 U05 が作る。CURRENT の `router.refresh()` は `refreshKey` を 1 増やし、`router.push(x)` は Ops 内なら `useNavigate()(x)`、Ops 外（`/dashboard`・公開 path）なら `window.location.assign(x)`。書き込み API の契約は D-16-1 の 1〜5 のとおり（暫定の型、merge 直前に `packages/contracts` の schema へ置き換え）。main に既にある書き込み API（announcements・api-endpoints・audit settings / dry-run・event template 削除）は最初から `packages/contracts` の schema を使う。
- **D-17-4（URL が未確定だった書き込み API の path）**: MIG-0637 / 0642 / 0643 / 0644 の Work Order は「URL は U01 の表で確定」としていた。画面と並行に作るために、ここで決める（API task は U01 の表にこの path を書き、変えるときは D-17 の変更として理由を書く）。body は D-16-1 の 2（CURRENT の FormData の key をそのまま JSON の key、path の id は body に送らない）、応答は D-16-1 の 3。
  - MIG-0637: SA-016 `POST /api/admin/cost-guard/mode`、SA-017 `POST /api/admin/cost-guard/maintenance`、SA-018 `POST /api/admin/cost-guard/override`、SA-019 `POST /api/admin/cost-guard/disabled-features`、SA-020 `POST /api/admin/cost-guard/override/clear`、SA-077 `POST /api/admin/users/:userId/role`、SA-078 `POST /api/admin/users/:userId/banned`、SA-079 `POST /api/admin/users/:userId/notifications`、SA-080 `POST /api/admin/users/:userId/can-create-events`、SA-081 `POST /api/admin/x-users/:xUserId/icon-refresh`。
  - MIG-0642: SA-045 `POST /api/admin/notifications/:id/retry`、SA-046 `POST /api/admin/notifications/:id/cancel`、SA-047 `POST /api/admin/notifications/:id/force-resend`、SA-048 `POST /api/admin/notifications/retry-failed`、SA-049 `PUT /api/admin/permissions/editable-fields`、SA-051 `POST /api/admin/terms`、SA-052 `PATCH /api/admin/terms/:id`、SA-053 `POST /api/admin/terms/:id/publish`、SA-054 `POST /api/admin/terms/:id/reaccept-broadcast`、SA-055 `POST /api/admin/terms/:id/archive`。
  - MIG-0643: SA-069 `POST /api/admin/static-builds/backfill`、SA-070 `POST /api/admin/static-builds/queue/:queueId/retry`、SA-071 `POST /api/admin/static-builds/rebuild`、SA-072 `POST /api/admin/static-builds/shared-inputs/rebuild`、SA-073 `POST /api/admin/static-builds/retry-failed`、SA-050 `POST /api/admin/visibility-repair`、SA-106 `POST /api/admin/youtube-sync/videos/:videoId/resync`。
  - MIG-0644: SA-092 `POST /api/admin/x-id-merges`、SA-093 `POST /api/admin/x-id-merges/:id/approve`、SA-094 `POST /api/admin/x-id-merges/:id/reject`、SA-096 `POST /api/admin/x-id-merges/:id/execute`、SA-097 `POST /api/admin/x-id-merges/reverts/:id/approve`、SA-095 `POST /api/admin/x-id-merges/reverts/:id/reject`（SA-110 の dispatcher は画面側で action ごとにこの path を呼ぶ）。
  - MIG-0662: SA-011 `POST /api/admin/audit/restore`。
- **D-17-5（redirect で結果を返していた Server Action）**: CURRENT で `redirect()` / form action の再描画で結果を出していたもの（SA-038 / 039 `?saved=1`・`?queued=1`・`?error=`、SA-050 `?visibility_repair=`、SA-069 `?backfill_*`、SA-108 / 109 `?notice=`・`?error=`、SA-092〜097 と SA-106 の再描画）は、API が CURRENT の redirect 先の query と同じ値を JSON で返し、画面が成功・失敗とも同じ query の URL へ `useNavigate()` で移って再取得する。画面の banner の分岐は CURRENT の query のまま移植する。これで URL を共有したときの表示も CURRENT と同じになる。
- **D-17-6（共有の部品と CSS）**: Ops の 2 task 以上が使う CURRENT の leaf 部品と global CSS は MIG-0707 U05 が 1 回だけ移す（一覧は MIG-0707 の Work Order）。画面 task の 2 つだけが使う部品は `apps/ops/src/components/<area>/` に先に merge した方が作り、後の方は import だけ（D-16-4 と同じ）: video 審査の部品（`VideoReviewQueueTable` / `VideoReviewQuickApproveButton` / `VideoApproveActions` / `VideoStatusForm` / `VideoReviewDetailPanel`）は MIG-0724 と MIG-0729、`XLinkRequestTable` は MIG-0725 と MIG-0732、`NotificationOutboxSummary` は MIG-0719 / 0720 / 0725 / 0734。`EventForm`（1120 行）は Manage の編集と `/admin/events/new` の両方を MIG-0721 が持つ。header / footer（`PublicHeader` / `PublicFooter`）は D-13-6 のとおり FIX-0701-1 が両 SPA に出すので、Ops の枠（MIG-0719 / 0726）には置かない。
- **D-17-7（GET の絞り込み form と件数上限）**: CURRENT の `<form method="get">` と `AutoSubmitSelect` は、同じ name の query を `useSearchParams` で URL に書き、読み API を同じ query で呼ぶ。Hono の読みが CURRENT より少ない件数で切る所（slots 500 → 100 × `offset`、videos 200 → 100 × `offset`、`slots.ts:10`・`videos.ts:13`）は、画面が `offset` を進めて CURRENT と同じ件数まで読む（最大 5 回 / 2 回、順に await）。`truncated` / `degraded` の flag は CURRENT に同じ表示が無ければ出さない（STOP ではない）。
- **D-17-8（health / integrity の全件実行）**: `GET /api/admin-read/ops/health?deep=1` と `/ops/integrity?run=1` は main では 501（`apps/api/src/routes/adminRead/ops.ts:240-242,328-329`）。これは MIG-0626 U05 / U06 が埋める予定なので、MIG-0736 の Merge gate に MIG-0626 を入れる。MIG-0626 が 501 を残すと決めたら、画面に「未対応」と出すことは機能の欠落なので MIG-0736 は STOP して Yugo の判断を待つ。
- **D-17-9（監査 restore API の担当の欠落）**: SA-011（`restoreAuditLogAction`、`src/lib/actions/audit-admin.ts:142-171`）の HTTP API はどの task にも無かった（MIG-0602 は MIG-0616 へ、MIG-0616 は core だけ、MIG-0629 は SA-009 / 010 だけ。main の `apps/api/src/routes/admin/audit.ts` は `/settings` と `/dry-run` だけ）。MIG-0662 を作る。restore は manifest・公開 cache・event export cache・Queue wake の本物の host が要り、それは MIG-0603 U02a（`apps/api/src/visibility/{videoTransitionHost,publicCacheKeys}.ts`）が作るので、MIG-0662 は MIG-0603 に依存する（BLOCKED）。MIG-0733（監査画面）の Merge gate に MIG-0662 を入れる。
- **D-17-10（admin の video member 画面）**: `/admin/videos/[id]/members` は `VideoMembersField`（1503 行）を使い、その移植は MIG-0713（Personal SPA、READY）。Ops から `apps/app` を import しないために、MIG-0730 が MIG-0713 の移植を `packages/ui/src/forms/videoMembers/` に移し、両 SPA がそこから import する。MIG-0730 は MIG-0713 に依存する（BLOCKED）。
- **D-17-11（MIG-0704 / 0705 の残り）**: MIG-0704 は Manage の Final audit だけになり、依存は MIG-0719..0725。MIG-0705 は Admin の Final audit だけになり、依存は MIG-0726..0737。MIG-0704 の旧依存 MIG-0604 / 0703 は外す（画面が呼ぶ API は各画面 task の Merge gate にある。MIG-0703 は Personal SPA の audit で Ops の画面は使わない）。MIG-0706 は MIG-0704, MIG-0705 に依存する。`apps/ops/wrangler.toml`（D-14-3）は MIG-0719 が持ち、MIG-0628 の `apps/app/wrangler.toml` と同じ形にするので MIG-0628 を MIG-0719 の Merge gate に入れる。
- **D-17-12（依存の付け替え）**: MIG-0606 → 従来 + MIG-0662〜0664。MIG-0607 → 従来 + MIG-0662〜0664。
- **D-17-13（MIG-0663、Manage navigation の 2 field）**: CURRENT の sidebar は active X と運営 X が食い違うと警告を出す（`src/components/layout/ConsoleSidebar.tsx:108`、判定 `packages/domain/src/video/ownership.ts:206-214`）。`GET /api/manage/navigation`（`apps/api/src/routes/manage/navigation.ts:9-25`）は `access` / `events` / `truncated` しか返さず、MIG-0719 U01 の STOP に当たる。`GET /api/manage` は同じ snapshot と data から `activeXUserId` / `manageStaffXUserIds` を返している（`apps/api/src/routes/manage/dashboard.ts:38-39`）ので、navigation に同じ式で足す。D1 の文は増えない。MIG-0663（READY、依存 MIG-0624）にし、MIG-0719 の Merge gate に足す。
- **D-17-14（Ops guard の `enrichmentFailed` の写像、MIG-0664）**: CURRENT の `(manage)` / `(admin)` layout は `enrichmentFailed` で `/entry?error=auth_temporarily_unavailable` へ移す（`app/(manage)/layout.tsx:30-32`、`app/(admin)/layout.tsx:24-26`）。`getLayoutAuthSurface` がこれを立てるのは管理権限の読みの失敗だけ（`src/lib/auth/requestAuthContext.ts:276-281`）。RH-001 はこの値を返さず、`degraded: true` は 2 つの原因で立つが応答では区別できない: 補助の pending 申請の読みの失敗（`apps/api/src/routes/account/summary.ts:221-232`、CURRENT では `enrichmentFailed` ではない）と、管理権限の読みの失敗（`:283-289`、CURRENT の `enrichmentFailed` に当たり、admin では起きない）。どちらでも `degradedBody`（`:167-190`）は `canAccessManage = role === "admin"` なので、非 admin の運営権限は分からない。原因を区別せずに非 admin を遮断すると、pending 申請の読みだけが失敗した運営者の Manage 画面が使えなくなり、CURRENT と違う（UX 変更で承認が要る）。よって: (1) MIG-0664 で RH-001 の 2 つの degraded 応答に `degradedReason`（`"pending_requests_unavailable"` / `"management_access_unavailable"`）だけを足す。他の値は変えない（RH-001 の CURRENT parity と `apps/site/src/lib/accountSummary.ts` の読み手を保つ）。MIG-0664 は MIG-0707 の Merge gate。(2) MIG-0707 U02 の guard は、503 `unavailable` → 両 SPA とも `/entry?error=auth_temporarily_unavailable`。`degradedReason: "management_access_unavailable"`（と、MIG-0664 前の暫定型で reason が無い degraded = fail closed）→ 両 SPA とも同じ `/entry?error=...`（CURRENT の `enrichmentFailed`）。`degradedReason: "pending_requests_unavailable"` → Admin SPA は `role` だけで判定（CURRENT :27）。Manage SPA は admin なら通し、非 admin は guard で判定せず、MIG-0719 U01 の `GET /api/manage/navigation`（権限を自分で計算する、`apps/api/src/routes/manage/access.ts:215-218`）の結果で決める: 200 → 表示、403 `manage_access_required` → `/dashboard`、500 / 503 → `/entry?error=auth_temporarily_unavailable`（CURRENT で管理権限の読みが失敗したときと同じ）。これで CURRENT と同じ Location になり、DOCUMENTED DIFFERENCE は残さない。

分割:

| 新 task | 画面 | Merge gate |
| --- | --- | --- |
| MIG-0719 | Manage の枠（layout guard・sidebar・banner）、`/manage`、`/manage/events/:id/review` の redirect、`apps/ops/wrangler.toml` | MIG-0707, MIG-0661, MIG-0628, MIG-0663 |
| MIG-0720 | `/manage/events/:id`、`/audience`（SA-035） | MIG-0707, MIG-0719, MIG-0655 |
| MIG-0721 | `EventForm` の移植、`/manage/events/:id/edit`（SA-021..024）、`/admin/events/new` | MIG-0707, MIG-0719, MIG-0726, MIG-0652 |
| MIG-0722 | `/manage/events/:id/slots`（SA-056..064） | MIG-0707, MIG-0719, MIG-0656 |
| MIG-0723 | `/manage/events/:id/staff`（SA-031..034） | MIG-0707, MIG-0719, MIG-0654 |
| MIG-0724 | `/manage/events/:id/videos`、`/videos/:videoId`（SA-040..042） | MIG-0707, MIG-0719, MIG-0603 |
| MIG-0725 | `/manage/events/:id/youtube-playlist`（SA-038 / 039）、`/manage/notifications`、`/manage/x-link-requests`（SA-090 / 091） | MIG-0707, MIG-0719, MIG-0655, MIG-0605 |
| MIG-0726 | Admin の枠（layout guard・sidebar・banner）、`/admin`、`/admin/permissions/simulator`、redirect 5 本 | MIG-0707, MIG-0661 |
| MIG-0727 | `/admin/announcements` 3 画面、`/admin/api-endpoints`、`/admin/rules` 3 画面（SA-051..055） | MIG-0707, MIG-0726, MIG-0642 |
| MIG-0728 | `/admin/event-groups` 3 画面（SA-025..030）、`/admin/events`、`/admin/events/templates` | MIG-0707, MIG-0726, MIG-0653 |
| MIG-0729 | `/admin/videos`、`/admin/videos/:id`（SA-001..003, 043） | MIG-0707, MIG-0726, MIG-0603 |
| MIG-0730 | `/admin/videos/:id/members`（SA-085、BLOCKED on MIG-0713） | MIG-0707, MIG-0726, MIG-0650, MIG-0648 |
| MIG-0731 | `/admin/users` 3 画面（SA-049, 077..081）、`/admin/moderation`（SA-044） | MIG-0707, MIG-0726, MIG-0637, MIG-0642, MIG-0603 |
| MIG-0732 | `/admin/x-link-requests`（SA-090 / 091）、`/admin/x-id-merges`（SA-092..097） | MIG-0707, MIG-0726, MIG-0605, MIG-0644 |
| MIG-0733 | `/admin/audit` 4 画面（SA-009..011） | MIG-0707, MIG-0726, MIG-0662 |
| MIG-0734 | `/admin/cost-guard`（SA-016..020）、`/admin/notifications`（SA-045..048） | MIG-0707, MIG-0726, MIG-0637, MIG-0642 |
| MIG-0735 | `/admin/static-builds`（SA-050, 069..073）、`/admin/youtube-sync` 2 画面（SA-106）、`/admin/youtube-quota` | MIG-0707, MIG-0726, MIG-0643 |
| MIG-0736 | `/admin/health`、`/admin/health/integrity`、`/admin/security`、`/admin/workers` | MIG-0707, MIG-0726, MIG-0626 |
| MIG-0737 | `/admin/spreadsheet`（RH-003..009）、`/admin/import`（RH-002） | MIG-0707, MIG-0726, MIG-0638, MIG-0645 |

理由: 画面群の境目は CURRENT の部品の境目（同じ client component を使う画面を同じ task に入れる）。1 task は CURRENT の client 部品で約 2,000 行以内。READY になるのは MIG-0719〜0729 と MIG-0731〜0737 の 18 件。MIG-0730 と MIG-0662 は依存の task が DONE になるまで BLOCKED。

見送ったもの: MIG-0610（MIG-0609 の測定値が要る）、MIG-0627 U02〜U05（MIG-0509 の build 経路が要る）、MIG-0803〜0805（MIG-0802 の `authjs.ts` が要る）、MIG-0714 / 0716 / 0717（MIG-0712 / 0713 の部品が要る）、Gate と本番の観測・操作。
