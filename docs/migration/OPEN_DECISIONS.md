# FlameNode Migration Decisions — adopted options & remaining evidence

> Status: Active / 仕様上の採用方針と実行ゲートの正本
> Last updated: 2026-10-09
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
| D-08 | **A: HTMLモックを先に確定してからUIを移行** | BLOCKED_ON_USER | MIG-0200..0206 / MIG-0402,0403 / Phase5 visual | HTMLの提供・SHA/版本・受入確認。**MIG-0401/0404/0405/0406の性能PoCは対象外** |

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

ユーザー選択はA。**HTMLはまだ受領していないため`BLOCKED_ON_USER`を維持**し、未登録のデザインをagentが生成/既存mockから推定したことにしない。

- 受領時に`UI_REFERENCE.md`へファイル、SHA、scope、受領日、画面とUX-ID対応を登録。承認されたHTMLを新UI正本とする。
- UI移行開始前にPhase2のvisual accept。移行中もCURRENTのUX/FN/API/権限/URL副作用を保持。
- 非UIのdomain/DBパッケージ抽出とAPI契約/計測は先行可。UIの実装/完成判定は保留。

## Open evidence — separate from design decisions

- D-01: packages/dbの実移設、循環依存/生成migration diffゼロ検証。
- D-02: 非本番hostnameにおけるRoute+Custom Domain PoC。設定作成はユーザー承認後。
- D-03/04: dry-runでの実データ件数・所有者不明/共有X衝突・write-freeze/rollback演習。
- D-05: Apps/Workersの2SPA buildとdeep link/asset分離のE2E。
- D-06: 本番のREAD ONLY COUNT、Static Assets files、CPU/1102負荷測定。リモートデータ取得の承認が必要なら別途取得。
- D-07: 既存auth cookie/session/OAuth契約の非本番PoC。
- D-08: HTMLモックの受領・acceptance。
