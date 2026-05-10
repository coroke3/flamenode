# UI・API/権限レビュー レポート (2026-05-04)

> このファイルは旧実装を確認した時点の参考レポートです。現在の正の設計は `PVSF-Master-Design.md`、`FlameNode-Design-System.md`、`FlameNode-Legacy-Data-Compatibility.md`、`FlameNode-Cloudflare-Free-Tier-Guardrails.md`、および `設計app/**.md` です。ここにある旧実装ファイル名や未実装指摘は、現在の設計仕様より優先しません。

## 対象
- [DESIGN_REVIEW_REPORT.md](DESIGN_REVIEW_REPORT.md)
- [PVSF-Master-Design.md](PVSF-Master-Design.md)
- [app/(public)/page.md](app/(public)/page.md)
- [app/(public)/list/page.md](app/(public)/list/page.md)
- [app/(public)/event/[id]/page.md](app/(public)/event/[id]/page.md)
- [app/(auth)/entry/page.md](app/(auth)/entry/page.md)
- [app/(auth)/dashboard/page.md](app/(auth)/dashboard/page.md)
- [app/(auth)/dashboard/settings/page.md](app/(auth)/dashboard/settings/page.md)
- [wrangler.toml](wrangler.toml)

---

## UI に関する検討点・改善余地

### 1) 仕様と実装のギャップ
- トップページは設計上「旧ページ風の短い上部導入帯 + 高密度横スクロール作品棚 + クリエイター棚 + イベントカード」を想定する。巨大ヒーローや強い背景演出ではなく、実データ連携と作品表示密度を優先する。
- エントリーは「規約同意 → 連携確認 → スロット選択」のステップ式が設計されているが、実装は 2 枚カードのみ。受付停止時のガードや TOS 同意の UI が未実装。
- ダッシュボードは「最優先アクションの強調 + ステータスカード + サイドバー」を前提としているが、実装は要素最小限で導線が弱い。
- 設定画面は「タブ式の多機能設定」を想定しているが、実装は X 連携・通知・TOS のみ。プロフィールやカスタムページ編集などが未実装。
- イベント詳細はスタッフ一覧やタイムライン公開、連続再生の設計があるが、実装は簡易表示のみ。

### 2) 体験と情報設計の改善
- 作品一覧の並び替えや検索が UI 上は存在するが、実データと接続されていない。サーバーコンポーネントで `window` を使っているため実行エラーの恐れがある。
- 作品一覧のフィルター（公開/限定/非公開）やイベント絞り込みが設計にあるが未実装。
- トップページのイベントカードに文字化けが混在（例: 「표시됩니다」）。コピーの統一とローカライズ精度を要確認。
- 重要な状態（空データ、エラー、読み込み中）へのフィードバックがページ間でばらついている。スケルトンやリトライ導線を統一したい。
- モバイル時のグリッド密度が高く可読性が下がる箇所があるため、ブレークポイントでの要素縮退設計が必要。

### 3) 管理 UI の不足
- 管理画面は全体がプレースホルダー。動画審査、ユーザー管理、イベント作成、履歴閲覧など「操作系 UI」が未実装。
- 監査ログの表示は設計上重要だが、検索やフィルタの UI がない。

### 4) アクセシビリティ/可用性
- リンクやボタンのフォーカス可視化、タブ移動の順序、色コントラスト（特に紫系アクセント）の確認が必要。
- 画像の代替テキストと、動画カードのキーボード操作（Enter で遷移）を担保する。

---

## API とアクセス権限の整理

### 1) 既存 API の状態と課題
- `/api/upload` はログイン必須だが、ファイル種別・サイズ上限・パス制御が未実装。
- `/api/webhooks/discord` は署名検証が未実装。Discord の Ed25519 検証が必須。
- `/api/legacy/*` は認証なし。旧システム向けでも API キーや IP 制限が必要。
- Server Actions は認可チェックが最小限（ログイン/管理者のみ）。所有権や BAN/TOS 状態の判定が不足。

### 2) 必要な API（機能単位）
**公開（未ログイン）**
- 作品一覧/検索（public only）
- イベント一覧/詳細/所属作品
- クリエイタープロフィール

**ログインユーザー**
- スロット取得/確保/解放
- 作品作成/更新/削除
- プロフィール更新（X 連携、通知設定、TOS 同意）
- アイコン画像アップロード（R2 署名 URL）

**管理者**
- 作品の審査（承認/差し戻し）
- イベント作成/編集/公開/受付停止
- ユーザー管理（BAN、X 連携承認、統合申請）
- 監査ログ検索/復元

**バックグラウンド**
- YouTube 同期
- スコア再計算
- 履歴クリーンアップ

### 3) 推奨アクセス権モデル
- `user`: 自身の投稿/スロット/プロフィールのみ操作可能。
- `moderator`: 作品審査、コメント/不適切報告の処理のみ。
- `admin`: 全権限（イベント管理、ユーザーBAN、X統合、履歴復元）。
- 所有権チェックを DB レベルで必須化（`owner_discord_user_id` と `session.user.id` の一致）。
- BAN/TOS 未同意ユーザーは投稿系 API を拒否。

### 4) 権限設定の実装パターン
- ページ保護: [middleware.ts](middleware.ts) で `/dashboard`, `/entry`, `/admin` を制御。
- API/Server Actions: `auth()` によるセッション取得 + ロール判定 + 所有権判定。
- Route Handler は CSRF 対策のため `Origin` or `Referer` の検証を統一。
- 監査ログなどの管理系 API は `admin` のみ許可。

### 5) 外部 API / 権限の設定方法（要点）
- Discord OAuth
  - 必要スコープ: `identify`, `guilds`（ギルド一覧）。
  - ギルド所属チェックが必要なら `guilds.members.read` の追加、または Bot トークンでの照合を準備。
- Discord Webhook
  - 公開鍵を環境変数で保持し、`X-Signature-Ed25519` と `X-Signature-Timestamp` を raw body で検証。
- YouTube Data API
  - API キーまたは OAuth を発行し、読み取り権限のみ付与。投稿可否の検証やメタデータ取得に使用。
- Cloudflare
  - D1/R2/KV のバインディングは [wrangler.toml](wrangler.toml) に定義済み。Pages 側の環境変数と一致させる。
  - R2 署名 URL はユーザー単位の prefix を必須にし、サイズ・MIME をサーバー側で検証。

---

## 優先度（提案）
- **High**: Webhook 署名検証、アップロード検証、所有権/権限チェック、管理画面の審査 UI。
- **Medium**: 設計ドキュメントとの UI ギャップ解消（Entry/Dashboard/Events/List）。
- **Low**: ビジュアル演出強化（旧ページ風の棚フェード、半透明矢印、控えめなホバー演出の整備）。
