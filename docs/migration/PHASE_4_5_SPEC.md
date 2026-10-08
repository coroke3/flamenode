# FlameNode Phase 4 & 5 タスク仕様書（Public Astro SSG & Islands Spec）

> 状態: Active / Phase 4 & 5 実行向け完全仕様書
> 対象モデル: Claude / Codex / Antigravity / GPT-5.6-luna / Gemini Flash 等の全エージェント
> 関連ドキュメント: [`README.md`](README.md), [`STATUS.md`](STATUS.md), [`UI_MIGRATION_GUIDE.md`](UI_MIGRATION_GUIDE.md), [`ROUTING_AND_DEPLOY_PLAN.md`](ROUTING_AND_DEPLOY_PLAN.md)

このドキュメントは、公開画面の移行（Phase 4: Public PoC / Phase 5: Public Migration）を軽量モデルでも一切迷わずに実装できるよう、全タスクの目的・作成ファイル・コード仕様・禁止事項・検証コマンドを完全に具体化した仕様書である。

---

# 1. 公開画面の基本方針

1. **Astro による静的生成（SSG）+ React Islands**:
   - リクエスト時のオンデマンド SSR は原則禁止。
   - 動的な対話要素（いいねボタン、チャプターシーク、検索フィルター等）のみ `client:load` または `client:visible` で React Islands としてマウントする。
2. **Free 枠ビルド制限の遵守**:
   - 主要ページ（トップ、一覧の1ページ目等）は事前ビルド。作品個別ページは ISR / On-Demand または Queue バッチによるデバウンス（5分バッチ）SSG ビルドトリガーとする。
3. **Thin Visibility Gateway**:
   - 公開可視性（Fail-Closed）はエッジゲートウェイで判定し、未公開・限定公開作品のメタデータや動画情報がキャッシュから漏洩しないことを保証する。

---

# 2. Phase 4: Public PoC タスク別仕様書

### MIG-0401: Astro build-input PoC
- **目的**: `apps/site` において、R2 プロジェクション JSON または D1 スナップショットからビルド時に入力データを読み込むローダーを検証。
- **作成ファイル**: `apps/site/src/lib/publicDataLoader.ts`
- **検証**: `npm run build --workspace=@flamenode/site`

### MIG-0402: shared React UI in Astro
- **目的**: `@flamenode/ui` のコンポーネント（アダプター経由の `Link`, `Image`）が Astro 内で React Island として正常にハイドレーションされることを検証。
- **作成ファイル**: `apps/site/src/components/IslandWrapper.tsx`
- **検証**: クライアントサイドでのクリックイベント・DOM ハイドレーション確認。

### MIG-0403: representative video/user/event SSG
- **目的**: 代表的な 1 件の動画・クリエイター・イベントページを SSG 出力するプロトタイプを作成。
- **作成ファイル**:
  - `apps/site/src/pages/[id].astro`
  - `apps/site/src/pages/users/[id].astro`
  - `apps/site/src/pages/event/[id].astro`

### MIG-0404: route-map generator
- **目的**: 静的ビルド対象となる全公開パス（一覧、イベント、ユーザー）を生成する `getStaticPaths` ヘルパーを構築。

### MIG-0405: visibility gateway
- **目的**: 公開状態（`public`, `unlisted`, `private`）に応じたアクセス制御と 404 / リダイレクトの fail-closed ゲートウェイをエッジ層に実装。

### MIG-0406: CPU/build benchmark
- **目的**: 1,000 件の静的ページ生成時のビルド時間および Workers CPU 時間（< 10ms）をベンチマーク測定し、Free 枠内に収まることを証明。

### MIG-0407: Phase 4 Gate
- **完了条件**: PoC 3 画面の表示、ハイドレーション、ビルド性能、可視性フェンスがすべて合格判定。

---

# 3. Phase 5: Public Migration タスク別仕様書

### MIG-0501: fixed/static routes（固定静的ルート）
- **対象**: `/terms`, `/privacy`, `/guidelines`, `/about` 等の静的情報ページを Astro へ移行。

### MIG-0502: event routes（イベント画面）
- **対象**: `/events`（イベント一覧）, `/event/[id]`（イベント詳細・タイムテーブル・参加作品リスト）。

### MIG-0503: group routes（イベントグループ画面）
- **対象**: `/event-group/[id]`（連続企画・シリーズイベント詳細）。

### MIG-0504: user routes（クリエイタープロフィール画面）
- **対象**: `/users/[id]`（クリエイター作品一覧、参加イベント履歴、リンク集）。

### MIG-0505: list/search/recommend/trending（一覧・検索・おすすめ・急上昇）
- **対象**: `/search`, `/recent`, `/popular`, `/recommend`, `/trending`。
- **仕様**: 検索入力とページネーションは React Islands（`client:load`）で高速動作。

### MIG-0506: root/top（トップページ）
- **対象**: `/`（トップ棚、ループシェルフ、急上昇ピックアップ）。
- **仕様**: PR #265 で移植した hover 自動スクロール最適化コンポーネントを流用。

### MIG-0507: `/:id` video catch-all（動画詳細キャッチオール）
- **対象**: `/:id`（動画プレイヤー、チャプター一覧、コメント一覧、関連動画）。
- **仕様**: チャプターシークと Active X 未連携時の登録モーダル誘導を完全連動。

### MIG-0508: Phase 5 Gate
- **完了条件**: 全公開ルート（74 画面）の移行完了、SEO / OGP メタデータの完全一致、Lighthouse パフォーマンス 95+ 達成。
