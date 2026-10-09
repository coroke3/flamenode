# FlameNode Phase 4 & 5 タスク仕様書（Public Astro SSG & Islands Spec）

> 状態: Active / Phase 4 & 5 実行向け仕様書
> 最終検証: 2026-10-09（`CURRENT_ROUTES.md` の Public 16 ルートおよび `ROUTE_MATRIX.md` に基づき改定）
> 対象モデル: Claude / Codex / Antigravity / GPT-5.6-luna / Gemini Flash 等の全エージェント
> 関連ドキュメント: [`README.md`](README.md), [`STATUS.md`](STATUS.md), [`CURRENT_ROUTES.md`](CURRENT_ROUTES.md), [`ROUTE_MATRIX.md`](ROUTE_MATRIX.md), [`OPEN_DECISIONS.md`](OPEN_DECISIONS.md) (D-02, D-06, D-08)

---

# 1. 公開画面の基本方針

1. **Astro による静的生成（SSG）+ React Islands**:
   - リクエスト時のオンデマンド SSR は原則禁止（`README.md` §8: "SSR never by default"）。
   - HTML 生成はビルド時に集中し、Workers Static Assets から配信。
   - 動的な対話要素（いいねボタン、チャプターシーク、検索フィルター等）のみ React Islands（`client:load` または `client:visible`）としてマウント。
2. **公開反映と Free 枠予算の遵守（D-06 参照）**:
   - 変更のたびに全件同期ビルドするのではなく、Queue によるデバウンス（`content-jobs` 経由の snapshot build）で反映。
   - Workers Static Assets Free上限は 20,000 files/version。CSS/JS/images/HTML/manifest/redirectを含め、MIG-0406で実ファイル数・上限余裕・build時間を測定する。
   - ファイル数超過時もSSRへ無条件移行しない。静的配信優先: Astro SSG → ビルド/QueueでR2へ事前生成したHTMLを軽量Workerで配信 → 実証済み限定SSR。R2 HTMLは数・ライフサイクル・オブジェクトread費用を別途測定。
3. **Thin Visibility Gateway**:
   - 可視性フェンス（Fail-Closed）はエッジゲートウェイ（薄い Worker）で検証し、非公開・限定公開データのキャッシュ漏洩を防止（`README.md` §8）。
4. **前提条件（D-08 参照）**:
   - Phase 4/5 の公開画面は、ユーザーから提供される新 HTML モック（Phase 2: `UI_REFERENCE.md`）が正本。HTML モック受領までは BLOCKED。

---

# 2. Phase 4: Public PoC タスク別仕様書

### MIG-0401: Astro build-input PoC
- **目的**: `apps/site` において、R2 プロジェクション JSON またはスナップショットからビルド時に入力データを読み込むローダーを検証。
- **作成ファイル**: `+apps/site/src/lib/publicDataLoader.ts`
- **検証**: `npm run build --workspace=@flamenode/site`

### MIG-0402: shared React UI in Astro
- **目的**: `@flamenode/ui` のコンポーネント（アダプター経由の `Link`, `Image`）が Astro 内で React Island として正常にハイドレーションされることを検証。
- **作成ファイル**: `+apps/site/src/components/IslandWrapper.tsx`
- **検証**: クライアントサイドでのハイドレーション確認。

### MIG-0403: representative video/user/event SSG
- **目的**: 代表的な 1 件の動画・クリエイター・イベントページを SSG 出力するプロトタイプを作成。
- **作成ファイル**:
  - `+apps/site/src/pages/[id].astro`（動画詳細代表）
  - `+apps/site/src/pages/user/[id].astro`（クリエイター代表）
  - `+apps/site/src/pages/event/[id].astro`（イベント代表）

### MIG-0404: route-map generator
- **目的**: 静的ビルド対象となる全公開パス（一覧、イベント、ユーザー、動画）を生成する `getStaticPaths` ヘルパーを構築。

### MIG-0405: visibility gateway
- **目的**: エッジ層で `public_visibility_fences` を参照し、非公開エンティティへのリクエストを fail-closed で遮断する薄いゲートウェイを実装。

### MIG-0406: CPU/build benchmark + bounded public fallback
- **目的**: 公開データ実数とAstroの**実出力ファイル数**、build時間、Worker CPU/1102、R2 fallbackを測定。CPU target p50<1.5ms, p95<3ms, p99<5ms; Free CPU hard limit 10msを超える経路がないことをストレス/異常系で確認する。
- **予算試算**: route × 固定/動的HTML数、出力asset、metadata/redirect/manifest、R2 byte/PUT/GET、Cloudflare request limitを含め、20,000 files/versionの上限超過をbuild preflightで停止する。2SPAの静的assetsは各Workerの別versionだがroot site側の容量を忘れない。
- **R2 HTML優先**: キャッシュミスをHTTP request中のrenderへフォールバックしない。非同期で事前生成したHTMLをR2から返却し、視認性ゲートを常にfail-closed、ETag/cache purge/OGP/canonical/alias/indexingを検証。R2が読めないときは安全な503等＋再生成enqueue（非公開漏洩禁止）。
- **限定SSR例外**: 事前データだけでは成立しないページごとにリスク理由・CPU/memory・負荷試験・無1102・影響ルート・戻し方をPRで承認したときのみ採用。Free 10msは非常に厳しいためSSR採用可能とは事前断言しない。

### MIG-0407: Phase 4 Gate
- **完了条件**: 代表3画面の表示・ハイドレーション・ビルド時間・可視性フェンス・SSG容量preflightとR2事前HTML異常系が合格。SSR例外を採用した場合はFreeのCPU/hard-limit下で検証通過した証拠が別途必要。

---

# 3. Phase 5: Public Migration タスク別仕様書（実ルート対応）

対象は `CURRENT_ROUTES.md` の **Public 16 ルート**（VISUAL_SCREEN 13 + COMPAT_REDIRECT 3）。

| Route | Class | 移行先 Astro パス | 備考 / 主なアクション |
|---|---|---|---|
| `/about` | VISUAL_SCREEN | `apps/site/src/pages/about.astro` | サービス説明 |
| `/rules` | VISUAL_SCREEN | `apps/site/src/pages/rules.astro` | 規約・ルール |
| `/event` | VISUAL_SCREEN | `apps/site/src/pages/event/index.astro` | イベント一覧・絞込 |
| `/event/[id]` | VISUAL_SCREEN | `apps/site/src/pages/event/[id]/index.astro` | イベント詳細・募集状況 |
| `/event/[id]/release` | VISUAL_SCREEN | `apps/site/src/pages/event/[id]/release.astro` | 公開順連続閲覧 |
| `/event/[id]/slots` | VISUAL_SCREEN | `apps/site/src/pages/event/[id]/slots.astro` | 公開枠状況確認 |
| `/groups` | COMPAT_REDIRECT | (Astro redirect) | `/event` への互換リダイレクト |
| `/groups/[slug]` | COMPAT_REDIRECT | (Astro redirect) | `/event#event-group-{slug}` への互換リダイレクト |
| `/user` | VISUAL_SCREEN | `apps/site/src/pages/user/index.astro` | クリエイター検索・探索 |
| `/user/[id]` | VISUAL_SCREEN | `apps/site/src/pages/user/[id]/index.astro` | クリエイタープロフィール・作品 |
| `/user/[id]/portfolio` | VISUAL_SCREEN | `apps/site/src/pages/user/[id]/portfolio.astro` | ポートフォリオ閲覧 |
| `/list` | VISUAL_SCREEN | `apps/site/src/pages/list.astro` | 作品一覧・検索（Island 連動） |
| `/recommend` | VISUAL_SCREEN | `apps/site/src/pages/recommend.astro` | おすすめ作品 |
| `/trending` | VISUAL_SCREEN | `apps/site/src/pages/trending.astro` | 注目・ランキング |
| `/` | VISUAL_SCREEN | `apps/site/src/pages/index.astro` | トップ棚・急上昇・お知らせ |
| `/[id]` | VISUAL_SCREEN | `apps/site/src/pages/[id].astro` | 動画再生・詳細・チャプター（最後） |

### タスク分割（MIG-0501〜0508）

- **MIG-0501: fixed/static routes**: `/about`, `/rules`
- **MIG-0502: event routes**: `/event`, `/event/[id]`, `/event/[id]/release`, `/event/[id]/slots`
- **MIG-0503: group compat routes**: `/groups`, `/groups/[slug]`（`/event` への互換リダイレクト）
- **MIG-0504: user routes**: `/user`, `/user/[id]`, `/user/[id]/portfolio`
- **MIG-0505: list/discover routes**: `/list`, `/recommend`, `/trending`（検索・ソートは React Islands 連動）
- **MIG-0506: root/top route**: `/`（トップページ、最適化済み hover スクロール棚コンポーネント流用）
- **MIG-0507: `/[id]` video catch-all**: `/[id]`（動画プレイヤー、チャプター、Active X モーダル誘導連携。最難関のため最後）
- **MIG-0508: Phase 5 Gate**: 全 Public 16 ルートの移行完了、SEO/OGP 完全一致、Lighthouse 性能確認。
