# FlameNode Claude Code 実装確認レポート

作成: 2026-05-18 13:25:19 +09:00
最終更新: 2026-05-18 22:41:04 +09:00

対象: `claude-code-subagent-assignment.md` の完全統合仕様に対する現行コード確認。

## 結論

- 主要な ID / 権限 / 投稿 / チャプター / 公開 API / health / security / 管理導線は、現行コード上で実装が確認できた。
- 不完全または防御が弱かった箇所を追加修正した。
- 選択 UI とページ導線について、スロット確保、X ID 切替、管理側の枠生成入力を追加で作り込んだ。
- 追加で、X ID アイコン選択/アップロード、候補検索の追加読み込み、ユーザー詳細の ID 主体整理、manage 通知の migration 未適用フォールバックを補強した。
- `npm run test:unit`、`npm run test:workers`、`npm run typecheck`、`npm run lint`、`npm run build` は通過。
- `pages:build` は Windows 環境の `spawn bash ENOENT` で失敗。これは既知の Windows 制約で、WSL / Git Bash / Linux での再確認が必要。

## 今回修正した点

### チャプター private 表示の防御強化

- `src/components/video/YoutubePlayer.tsx`
  - private チャプターを `marker_kind === "chapter"` だけで表示し得る条件を削除。
  - プレイヤー単体でも `visibility === "public"` または `is_owner` の場合だけ表示するようにした。

- `app/(public)/[id]/page.tsx`
  - DB クエリで可視化済みの private チャプターをプレイヤーにも出せるよう、private 行には `is_owner: true` を渡す。
  - これにより、許可済み private は表示され、未許可 private はコンポーネント境界でも漏れにくくなる。

### 通知キューの Discord ID 解決と Worker 配信補強

- `src/lib/auth/index.ts`
  - Discord OAuth 連携時に `users.discord_id` を `account.providerAccountId` で保存する。
  - 連携済み `account.access_token` も DB 上で null に更新する。

- `src/lib/notifications/enqueue.ts`
  - 通知投入時に、内部 `users.id` / `users.discord_id` / `accounts.providerAccountId` のどれを渡されても Discord 送信先 ID へ解決してから `notification_outbox.discord_user_id` に保存。
  - 解決できない非 Snowflake 文字列は enqueue せず、壊れた送信先を outbox に積まない。
  - 投入成功可否を boolean で返すようにした。既存の戻り値未使用呼び出しとは互換。

- `workers/notification-dispatcher/index.ts`
  - `discord_dm` 以外の通知 type でも、Bot token がある場合は DM として配信できるようにした。
  - `x_id_approved`、`video_approved`、`chapter_comment_added`、`announcement_broadcast` などの通常通知が outbox で失敗し続ける状態を避ける。
  - `discord_webhook` は webhook URL がない場合に DM fallback せず、設定不足として失敗扱いにする。

- `src/lib/actions/broadcast-admin.ts`
  - broadcast の outbox 直挿入をやめ、`enqueueNotification` 経由に変更。
  - 送信先 ID 解決、payload validation、event_id の扱いを通常通知と揃えた。

- `workers/notification-dispatcher/index.test.mjs`
  - 通常通知の DM 配信、webhook URL なし時の非 fallback、webhook URL あり時の webhook 配信を追加テスト。

### 作品編集の section 権限チェック補強

- `src/lib/auth/videoEditSections.ts` / `src/lib/auth/ownership.ts`
  - 管理 UI が付与する既存 permission_key (`videos.title` など) と、編集判定側の section key (`video.basics` など) を alias として対応。
  - `video.members`、`video.youtube_id`、`video.primary_event` を型に追加し、section 単位の判定を明示。

- `src/lib/constants/collaborator-permissions.ts`
  - `video.chapter_admin` を管理 UI で付与できる permission_key に追加。

- `app/(auth)/dashboard/edit/[id]/page.tsx`
  - 作品編集ページを「どれか1 sectionでも編集権限があれば表示」に変更。
  - 提出者情報、基本情報、YouTube ID、楽曲/クレジット、紹介文、合作メンバーの各権限から disabled section / disabled field を算出。

- `src/lib/actions/video.ts`
  - `updateVideo` の `video.basics` 一本判定を廃止。
  - API / Server Action 側で、提出者情報、タイトル、YouTube ID、楽曲/クレジット、紹介文、合作メンバーを個別に権限チェック。
  - 権限がない section は既存値を保持し、API 直叩きで変更しようとした場合は拒否。

- `src/components/forms/VideoForm.tsx` / `src/components/forms/VideoMembersField.tsx`
  - field 単位の disabled / readOnly 表示を追加。
  - 合作メンバー入力も権限がない場合は入力・追加・削除・CSV貼り付けを無効化。

### 入力 UI の候補補完

- `src/lib/db/videoFormSuggestions.ts`
  - 既存作品の `used_software` から使用ソフト候補を取得する helper を追加。

- `src/components/forms/VideoForm.tsx`
  - 使用ソフト欄に既存データ由来の datalist 候補を追加。

- 投稿・編集ページ
  - 枠なし投稿、枠あり投稿、作品編集で使用ソフト候補を渡すように変更。

### 選択 UI / ページ導線の作り込み

- `src/components/event/SlotGrid.tsx` / `src/components/event/SlotGrid.module.css`
  - 空き枠を `○ 空き枠` ボタンとして表示し、クリック後にモーダルで表示名・団体名と連続取得数を選ぶ UI に変更。
  - 連続枠は保存時の `consecutive_count` に渡し、見た目だけの結合ではなく既存の reservation group ロジックへつなげる。
  - 前回入力した表示名を引き続き localStorage から復元する。

- `app/(public)/event/[id]/page.tsx`
  - 予約枠セクションに `id="slot"` を付与し、エントリー導線から直接枠選択位置へ飛べるようにした。

- `app/(auth)/dashboard/settings/page.tsx`
  - 連携 X ID 一覧をテーブルからカード型の選択 UI に変更。
  - アイコン、表示名、`@id`、承認状態、アクティブ状態、プロフィール導線を1つの選択面として見えるようにした。

- `src/components/admin/SlotBatchForm.tsx`
  - 枠一括生成の「開始間隔」「枠の長さ」に候補ボタンを追加。
  - 5分 / 6分 / 10分 / 15分など、イベント枠生成でよく使う値をワンクリックで選べるようにした。

### プロフィール / 候補検索 / ID 主体表示の補強

- `src/components/settings/XIdSettingsClient.tsx` / `src/components/settings/XIdSettingsClient.module.css`
  - X ID アイコン設定を「候補から選ぶ」「新規アップロード」の2択 UI に整理。
  - 候補アイコンはプレビュー付きグリッドで表示し、現在選択中のアイコンを明示。
  - アップロード側にもプレビュー面を追加し、250x250 程度の正方形推奨、PNG/JPEG/WEBP、2MB までを画面上で案内。

- `src/lib/actions/xid.ts`
  - 手動アップロードアイコンを X ID あたり 24 件までに制限し、無制限アップロード状態を避ける。
  - アイコン変更後に `/dashboard`、`/`、`/user/[id]` も再検証対象へ追加。

- `app/api/internal/x-users/search/route.ts` / `src/components/forms/VideoMembersField.tsx`
  - X ID 候補検索に `offset`、`hasMore`、`nextOffset` を追加。
  - 合作メンバー入力で候補の検索中、候補なし、取得失敗、追加読み込みを区別して表示。

- `app/(admin)/admin/users/[id]/page.tsx`
  - 管理側ユーザー詳細に「Discord / Auth 主体」「Active X ID」「紐づく X ID」を分けて表示する ID 主体整理カードを追加。
  - 連携 X ID 一覧もカード型にし、Active / 承認状態 / X プロフィール導線を見やすくした。

- `app/(manage)/manage/page.tsx` / `app/(manage)/manage/events/[id]/page.tsx`
  - 古いローカル D1 で `notification_outbox.event_id` migration が未適用でも、運営ページ全体が 500 にならないようにフォールバック。
  - migration 未適用時は `npm.cmd run db:local-apply` を促す警告を表示。

- `app/(public)/recommend/page.tsx`
  - 公開 UI の「スコアから見る」を「おすすめを見る」へ変更し、硬い文言を整理。

## 現行コードで確認した実装済み項目

### Auth / 起動時エラー対策

- `src/lib/auth/index.ts`
  - `secret` は `process.env.AUTH_SECRET` / `NEXTAUTH_SECRET` / `getEnv().AUTH_SECRET` / ローカル開発用 fallback から解決。
  - Discord OAuth 値も `process.env` 優先、Cloudflare env fallback。
  - `MissingSecret` 対策は実装済み。

- `src/lib/utils/format.ts`
  - `formatUnix` / `formatRelative` は `NaN`、`Infinity`、非数値文字列、不正 Date を防御。
  - トップページの `Invalid time value` 対策は実装済み。

### ID / 権限 / 共通書き込みガード

- `src/lib/auth/writeGuard.ts`
  - login、BAN、TOS、terms reaccept、CostGuard、Active X ID、承認済み X ID を共通判定。

- `src/lib/auth/currentUser.ts`
  - `is_tos_accepted`、`terms_reaccept_required`、`is_banned`、`active_x_user_id` を取得。

- `src/lib/auth/ownership.ts`
  - `canEditVideo` は `requiredKey` 必須。
  - `owner_discord_user_id` 単独で編集許可しない。
  - `videos.*` 形式の既存 collaborator permission と `video.*` 形式の section key を alias 解決する。

### 投稿 / YouTube ID / Active X ID

- `src/lib/actions/video.ts`
  - 枠なし投稿は承認済み Active X ID 必須で `status = public`。
  - `contact_x_id` 入力は server 側で信用せず、Active X ID から導出。
  - YouTube URL / 短縮 URL / ID は `extractYoutubeId` で正規化して保存。
  - 枠あり提出は承認済み Active X ID 必須、pending 開始、slot group を submitted 更新。

### スロット / 部番号

- `src/lib/actions/slot.ts`
  - 連続枠予約、ロールバック、部分解放、中央分割、隣接拡張、中間空き枠の結合を実装。
  - 未承認 Active X ID でも枠確保系操作は可能。rejected / missing / BAN / TOS / CostGuard は `writeGuard` で拒否。

- `src/lib/utils/slotGroupingCore.ts`
  - ソートは `start_time`、`end_time`、`sort_order`、`id` の順に安定化。
  - 部番号分割は gap、JST 日付変更、`slot_kind` 変更に対応。

- `src/components/admin/EventForm.tsx`
  - `slot_part_gap_minutes` をイベントごとに設定可能。

### いいね / セーブ / ライブラリ

- `videoInteractions.x_user_id` を主体に使用。
- `toggleVideoInteraction` は `writeGuard({ requireApprovedActiveXId: true })` を通る。
- `/dashboard/library` と動画詳細の取得は Active X ID で切り替わる。

### チャプターコメント

- `src/lib/actions/chapter.ts`
  - `video_chapters` を使用し、`video_comments` は使わない。
  - 投稿は承認済み Active X ID、BAN/TOS/CostGuard、FlameNode 内 `public` / `unlisted` のみ許可。
  - `marker_kind` は入力されても `chapter` に固定。

- `src/lib/db/videoDetailQueries.ts`
  - public は全員、private は admin / 動画編集権限者 / 投稿者本人のみ取得。

### 公開 API / health / security

- `src/lib/api/publicDto.ts`
  - 公開 API の返却キーを whitelist 化。
  - Discord ID、email、role、BAN、TOS、token、private note などを禁止キーとして検査。

- `src/lib/admin/healthChecks.ts`
  - system_settings、primary_event_id / video_events、slot 整合、like_count drift、deprecated 項目などを検査。
  - reservation group は Discord user / X ID の混在を検出。

- `src/lib/admin/securityChecks.ts`
  - access_token、rejected active X、未承認 X 投稿、BAN/TOS 書き込み、custom HTML 危険タグを検査。
  - `owner_discord_user_id` は `users.id` と legacy `users.discord_id` の両対応で検査。

## 検証結果

- `npm.cmd run test:unit`
  - PASS: 160 tests
  - Node の `MODULE_TYPELESS_PACKAGE_JSON` 警告あり。既存の package type 未指定による警告で、テスト失敗ではない。

- `npm.cmd run test:workers`
  - PASS: 23 tests

- `npm.cmd run typecheck`
  - PASS

- `npm.cmd run lint`
  - PASS: No ESLint warnings or errors

- `npm.cmd run build`
  - PASS

- `npm.cmd run test:unit` / `npm.cmd run typecheck` / `npm.cmd run lint` / `npm.cmd run build`
  - 選択 UI 追加後に再実行し、いずれも PASS。

- `npm.cmd run typecheck`
  - プロフィール / 候補検索 / manage fallback 追加後に再実行し PASS。

- `npm.cmd run lint`
  - PASS: No ESLint warnings or errors

- `npm.cmd run test:unit`
  - PASS: 160 tests

- `npm.cmd run build`
  - 1回目は `.next` の一時的な page module 解決不整合で `/admin/history` / `/admin/import` の PageNotFoundError が出た。
  - 同一差分で再実行し PASS。最終結果は成功。

- `npm.cmd run dev:local`
  - 選択 UI 追加後にローカル起動確認。
  - `/` -> 200
  - `/entry` -> 200
  - `/api/auth/providers` -> 200

- `npm.cmd run dev:local -- -p 3104`
  - `/` -> 200
  - `/entry` -> 200
  - `/recommend` -> 200
  - `/api/internal/x-users/search?q=test&limit=1` -> 401
  - 内部 X ID 検索 API は認証必須のため 401 が期待値。

- `npm.cmd run db:local-apply`
  - PASS 相当: `No migrations to apply!`
  - Wrangler がユーザープロファイル配下のログファイル作成に `EPERM` を出したが、コマンド exit code は 0。

- `node scripts/check-public-api-leaks.mjs http://localhost:3102`
  - PASS
  - `/api/videos` と `/api/events` の禁止キー漏洩なし。

- `npm.cmd run dev:local -- -p 3102` でローカル HTTP 確認
  - `/` -> 200
  - `/api/auth/providers` -> 200
  - `/api/videos?limit=1` -> 200
  - `/api/events?limit=1` -> 200
  - `MissingSecret` とトップページ 500 はこの確認経路では再現せず。

- `npm.cmd run pages:build`
  - FAIL: `Error: spawn bash ENOENT`
  - Windows 上の `next-on-pages` 既知制約。WSL / Git Bash / Linux で再実行が必要。

## 残る未確認・継続項目

- ブラウザ操作での権限なし API 直叩き、X ID 切替、連続枠の部分解放・拡張・結合の実データ操作は未実行。
- Codex の Browser ツールはこのターンでは呼び出し可能な状態ではなかったため、今回の選択 UI は HTTP ステータスと typecheck / lint / build / unit test までの確認に留まる。
- mobile viewport の目視確認は未実行。
- `pages:build` は Windows では完了不能だったため、Cloudflare Pages 最終互換性は WSL / Linux 側で確認が必要。
- 今回この確認で触った主なコード差分は、チャプター表示、通知キュー、作品編集 section 権限、編集フォーム disabled 表示、使用ソフト候補、スロット選択モーダル、X ID 選択カード、枠生成候補ボタン、アイコン選択/アップロード、候補検索追加読み込み、管理側ユーザー詳細の ID 主体表示、manage 通知 fallback に関係するファイル群。検証で `tsconfig.tsbuildinfo` も更新されている。

## 18時継続条件

- 13:25 JST 時点では 18:00 前だったため、通知キュー、Discord ID 解決、Worker 配信、broadcast 経路、追加 worker tests まで確認・修正を継続した。
- その後、22:10 JST 時点で section 権限、編集フォーム、使用ソフト候補まで追加修正し、typecheck / lint / unit / worker / build を再実行した。
- 22:28 JST 時点で、スロット選択モーダル、X ID 選択カード、枠生成候補ボタンの追加作り込みまで完了し、typecheck / lint / unit / build とローカル HTTP 確認を再実行した。
- 22:41 JST 時点で、アイコン選択/アップロード、候補検索追加読み込み、管理側ユーザー詳細の ID 主体表示、manage 通知 fallback、公開文言整理まで追加し、typecheck / lint / unit / build / db:local-apply / dev:local HTTP 確認を再実行した。

## 追加対応: 管理/運営入口と `/manage` 分離

### 実装内容

- `src/lib/auth/managementAccess.ts`
  - `event_editors` と `event_collaborator_permissions` から、ログインユーザーが運営可能なイベントを導出する `getManagementAccess()` を追加。
  - `admin` は `/admin` と `/manage` の両方へ入れる扱いにし、通常ユーザーは担当イベントがある場合だけ `/manage` を許可する。
- `src/lib/auth/headerUser.ts`
  - `HeaderUser` に `role` と `management` を追加。
  - DB側の `users.role` を優先し、ヘッダー描画時点で `canAccessAdmin` / `canAccessManage` / `manageableEventCount` を持てるようにした。
- `src/components/layout/AuthHeader.tsx`
  - すべてのログインユーザーに出ていた `/manage` リンクを撤去。
  - `admin` には「管理」リンク、イベント運営権限者には「運営」リンクを条件表示するよう変更。
- `src/components/layout/PublicHeader.tsx`
  - 公開側ヘッダーでもログイン済みユーザーに対し、権限がある場合だけ「管理」または「運営」を表示。
  - モバイルメニューにも同じ条件表示を追加。
- `app/(manage)/layout.tsx`
  - `/manage` 全体をレイアウトでガード。
  - 未ログインは `/entry`、管理/運営権限なしは `/dashboard` へリダイレクト。
- `app/(admin)/layout.tsx`
  - `HeaderUser` の `role` をそのまま使う形に整理し、`/admin` は admin 専用のまま維持。

### 検証

- `npm.cmd run typecheck`
  - PASS
- `npm.cmd run lint`
  - PASS: No ESLint warnings or errors
- `npm.cmd run test:unit`
  - PASS: 160 tests
  - `MODULE_TYPELESS_PACKAGE_JSON` 警告は既存の package type 未指定由来で、テスト失敗ではない。
- `npm.cmd run build`
  - PASS
- `git diff --check`
  - PASS
  - Git の CRLF 変換 warning と global ignore permission warning は出たが、whitespace error はなし。
