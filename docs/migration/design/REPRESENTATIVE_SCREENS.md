# 代表3画面 UX 実装分類台帳 (Representative Screens UX Ledger)

> Status: Active
> Last updated: 2026-10-17
> Owner task: MIG-0205
> Source of truth: `docs/migration/mock/` (`VideoDetail.html`, `EventDetail.html`, `Creator.html`), `docs/migration/frontend/PUBLIC.md`

## 概要

FlameNode 移行 Phase 2（MIG-0205）において実装された代表3画面コンポーネント（`@flamenode/ui`）：
1. **VideoDetailView** (`packages/ui/src/screens/VideoDetailView.tsx`): 作品詳細画面 (`/[id]`)
2. **EventDetailView** (`packages/ui/src/screens/EventDetailView.tsx`): イベント詳細画面 (`/event/[id]`)
3. **CreatorView** (`packages/ui/src/screens/CreatorView.tsx`): クリエイタープロフィール画面 (`/user/[id]`)

本ドキュメントでは、各画面に対応する UX ID（`docs/migration/frontend/PUBLIC.md`）の対応状況を「保持 (RETAINED)」「未対応 (DEFERRED)」「次MIG (NEXT_MIG)」の3分類で全件記録する。

---

## 1. 作品詳細画面 (`VideoDetailView.tsx` / `/[id]`)

| UX ID | 機能概要 | 画面上の配置・表現 | 状態 | 次MIG / 担当 |
| --- | --- | --- | --- | --- |
| UX-VID-001 | internal video IDのURLで作品を開く | ルート解決・データローダー | 次MIG | MIG-0403 (Astro SSG) |
| UX-VID-002 | YouTube video ID aliasのURLで作品を開く | ルートエイリアス解決 | 次MIG | MIG-0403 / MIG-0405 |
| UX-VID-003 | public/non-public visibilityに応じた安全表示 | `isBlocked`/`isUnavailable` 時の EmptyState 抑制 | 保持 | MIG-0205 (コンポーネントガード) / MIG-0405 (ゲートウェイ) |
| UX-VID-004 | YouTube playerで作品を再生する | 16:9 埋め込みプレイヤー iframe | 保持 | MIG-0205 |
| UX-VID-005 | YouTube未登録時のfallback閲覧 | 未登録時のフォールバック通知タイル | 保持 | MIG-0205 |
| UX-VID-006 | view閲覧の安全計測 | 閲覧ビーコン（Island） | 次MIG | Phase 5 (Island) |
| UX-VID-007 | 作品titleを確認する | タイトルヘッダー `<h1>` | 保持 | MIG-0205 |
| UX-VID-008 | creator identity/icon/X IDを確認する | 投稿者情報バー（アイコン・表示名・ID・公開日） | 保持 | MIG-0205 |
| UX-VID-009 | creatorのFlameNode profileへ移動する | 投稿者名リンク (`/user/[id]`) | 保持 | MIG-0205 |
| UX-VID-010 | creatorのX profileを外部で開く | X アイコンリンク (`https://x.com/...`) | 保持 | MIG-0205 |
| UX-VID-011 | creatorのYouTube channelを外部で開く | YouTube アイコンリンク | 保持 | MIG-0205 |
| UX-VID-012 | 作品のmusic/creditを確認する | 作品情報ボックス（使用楽曲・クレジット） | 保持 | MIG-0205 |
| UX-VID-013 | music reference URLを外部で開く | 楽曲リンク | 保持 | MIG-0205 |
| UX-VID-014 | intro commentを見る | 作品情報ボックス（紹介文） | 保持 | MIG-0205 |
| UX-VID-015 | 使用software情報を見る | 作品情報ボックス（使用ソフト一覧） | 保持 | MIG-0205 |
| UX-VID-016 | highlightsを見る | 詳細コメント開閉（みどころ） | 保持 | MIG-0205 |
| UX-VID-017 | production storyを見る | 詳細コメント開閉（制作エピソード） | 保持 | MIG-0205 |
| UX-VID-018 | closing commentを見る | 詳細コメント開閉（あとがき） | 保持 | MIG-0205 |
| UX-VID-019 | primary eventとstatusを確認し移動 | イベントバー（名前・ステータスバッジ・リンク） | 保持 | MIG-0205 |
| UX-VID-020 | event受付中状態を見る | イベントバーのステータス表示 | 保持 | MIG-0205 |
| UX-VID-021 | event YouTube playlistを外部で開く | 再生リストリンク | 保持 | MIG-0205 |
| UX-VID-022 | 複数所属eventをtagから開く | 「他の所属」タグリンク | 保持 | MIG-0205 |
| UX-VID-023 | public member一覧・role/commentを見る | 参加メンバー一覧（テーブル / カード切替） | 保持 | MIG-0205 |
| UX-VID-024 | memberに紐づくchapter担当情報を見る | メンバーテーブルのチャプター列 | 保持 | MIG-0205 |
| UX-VID-025 | likeを付ける/外す | いいねボタントリガー（UI部品） | 未対応 | MIG-0504 (React Island) |
| UX-VID-026 | bookmark/saveを付ける/外す | セーブボタントリガー（UI部品） | 未対応 | MIG-0504 (React Island) |
| UX-VID-027 | interaction中のpending/active状態を見る | ボタンの aria-pressed / loading | 未対応 | MIG-0504 (React Island) |
| UX-VID-028 | 未ログイン時にlike/saveからloginへ進む | 認証モーダル / ログイン遷移 | 次MIG | MIG-0504 (React Island) |
| UX-VID-029 | terms未同意時のinteraction抑止 | 同意モーダル遷移 | 次MIG | MIG-0504 (React Island) |
| UX-VID-030 | banned/auth unavailable時の理由表示 | エラーコールアウト | 次MIG | MIG-0504 (React Island) |
| UX-VID-031 | public chapter/comment一覧を見る | サイドバーのチャプター一覧（時間・ラベル・作者） | 保持 | MIG-0205 |
| UX-VID-032 | chapter操作でplayerをseekする | チャプタークリック時のプレイヤー連動 | 未対応 | MIG-0504 (React Island) |
| UX-VID-033 | playback位置に対応するchapterのactive表示 | 再生位置追従のハイライト | 未対応 | MIG-0504 (React Island) |
| UX-VID-034 | private chapterの権限制御表示 | 権限者用バッジ付き表示 | 次MIG | Phase 5 (Island) |
| UX-VID-035 | 動画尺外chapterの範囲外表示 | 範囲外バリデーション | 次MIG | Phase 5 (Island) |
| UX-VID-036 | chapter投稿sheetの表示 | 投稿シートフォーム | 未対応 | Phase 5 (Island) |
| UX-VID-037..051 | chapter composer/CSV一括登録 | チャプター編集UI | 次MIG | Phase 5 / 管理UI |
| UX-VID-052 | viewer utility dock機能 | ユーティリティドック（Island） | 次MIG | Phase 5 (Island) |
| UX-VID-053 | related videosを見る | 関連作品スロット | 保持 | MIG-0205 (レイアウト枠) / MIG-0403 |
| UX-VID-054 | related data利用不能時のdegraded表示 | フォールバック通知 | 保持 | MIG-0205 |
| UX-VID-055 | VideoObject JSON-LD/metadataの外部公開 | Head メタデータ / OGP | 次MIG | MIG-0403 (Astro SSG) |

---

## 2. イベント詳細画面 (`EventDetailView.tsx` / `event/[id]`)

| UX ID | 機能概要 | 画面上の配置・表現 | 状態 | 次MIG / 担当 |
| --- | --- | --- | --- | --- |
| UX-EVENT-006 | event title/icon/description概要確認 | メインビジュアル、イベントアイコン、タイトル、概要文 | 保持 | MIG-0205 |
| UX-EVENT-007 | event stage/statusを見る | イベントステータスバッジ (`Badge status=...`) | 保持 | MIG-0205 |
| UX-EVENT-008 | event募集受付中/終了等の状態確認 | 開催期間表示、募集締切カウントダウン指標 | 保持 | MIG-0205 |
| UX-EVENT-009 | event所属public作品一覧を見る | 投稿作品グリッド（サムネイル、タイトル、クリエイター、尺） | 保持 | MIG-0205 |
| UX-EVENT-010 | event entry可能時の参加/投稿導線 | 「枠を確保」「作品を提出」アクションボタン | 保持 | MIG-0205 |
| UX-EVENT-011 | event external/playlist等の関連link確認 | 枠表へのリンク、投稿予定へのリンク | 保持 | MIG-0205 |
| UX-EVENT-012 | event非公開/blocked時の情報遮断 | `isBlocked`/`isUnavailable` 時の EmptyState 抑制 | 保持 | MIG-0205 (コンポーネントガード) / MIG-0405 (ゲートウェイ) |

---

## 3. クリエイタープロフィール画面 (`CreatorView.tsx` / `user/[id]`)

| UX ID | 機能概要 | 画面上の配置・表現 | 状態 | 次MIG / 担当 |
| --- | --- | --- | --- | --- |
| UX-USER-006 | creator identity/icon/display name確認 | プロフィールヘッダー（アバター、名前、ハンドル） | 保持 | MIG-0205 |
| UX-USER-007 | creatorのX profileを外部で開く | X (𝕏) アイコンリンク | 保持 | MIG-0205 |
| UX-USER-008 | creatorのYouTube channelを外部で開く | YouTube (▶) アイコンリンク | 保持 | MIG-0205 |
| UX-USER-009 | creator profile blocks/about content確認 | サイドバーの「About」「Contact」セクション | 保持 | MIG-0205 |
| UX-USER-010 | creatorのworks (作品) を見る | 「作品」セクション、グリッド一覧、ポートフォリオリンク | 保持 | MIG-0205 |
| UX-USER-011 | creatorのcollab (参加作品) を見る | 「参加作品」セクション、グリッド一覧 | 保持 | MIG-0205 |
| UX-USER-012 | works/collabの独立ページネーション | ページネーション用UIスロット | 保持 | MIG-0205 (UI) / MIG-0403 (URLクエリ) |
| UX-USER-013 | profile queryをdeep-link/back-forwardで維持 | クエリパラメータ復元 | 次MIG | MIG-0403 (Astro SSG / SPA) |
| UX-USER-014 | profileのempty statesを見る | 作品・参加作品が空の際の案内表示 | 保持 | MIG-0205 |

---

## 4. レスポンシブ設計 (Desktop 1440px / Mobile 390px)

- **Desktop (1440px)**:
  - VideoDetail: メイン動画 + 作品情報 + チャプターサイドバーの2カラムグリッド (`minmax(0, 1fr) minmax(280px, 360px)`).
  - EventDetail: 4:1 アスペクト比バナー + メイン（概要・枠・投稿）とサイド（日程）の分割レイアウト.
  - Creator: アバター横並びヘッダー + 作品・参加作品グリッドと About/Contact サイドバーの分割レイアウト.
- **Mobile (390px)**:
  - 全レイアウトコンテナで `minmax(0, 1fr)` および `flex-wrap: wrap` を徹底し、横スクロールはみ出し（overflow）ゼロを保証.
  - メンバー一覧テーブルは `TableScroll` による明示的水平スクロール領域としてカプセル化（`role="region"`, `tabIndex={0}`）.
