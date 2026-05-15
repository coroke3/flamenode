# FlameNode 詳細設計・最終版

## 1. ID設計

### 1-1. Discord ID

Discord IDはログイン・通知・BAN・TOS・admin権限の主体である。  
作品表示やいいねの主体にはしない。

使用領域:

- Auth.jsログイン
- User
- Session
- BAN
- TOS同意
- 通知
- admin/moderator role
- Discordへの連絡

### 1-2. X ID

X IDは作者・作品・プロフィール・アイコン・いいね/セーブ/ライブラリの主体である。

使用領域:

- 作品作者
- クリエイターページ
- 作品一覧の表示名
- アイコン候補
- いいね
- セーブ
- ライブラリ
- チャプターコメント投稿者
- イベント運営者としての表示

### 1-3. Active X ID

Active X IDは、ログインユーザーが現在どのX IDとして操作しているかを示す。

Active X ID切替で切り替わるもの:

- 自分の作品一覧
- いいね
- セーブ
- ライブラリ
- 全て再生プレイリスト
- アイコン候補
- プロフィール編集対象
- 枠確保時のX ID
- 投稿時の作者X ID
- チャプターコメント投稿者

切り替わらないもの:

- ログイン状態
- BAN
- TOS
- admin role
- 通知先Discordユーザー

---

## 2. 共通書き込みガード

投稿、編集、枠提出、いいね、セーブ、チャプターコメントなど、全ての書き込み操作は共通ガードを通す。

確認項目:

- ログイン済み
- BANされていない
- TOS同意済み
- CostGuard上、その機能が書き込み可能
- 必要に応じてActive X IDがある
- 必要に応じてActive X IDが承認済み
- 必要に応じて対象データの表示・編集権限がある

未承認X IDで許可されるのは枠確保のみ。

---

## 3. 投稿設計

### 3-1. 枠なし投稿

条件:

- ログイン済み
- BANなし
- TOS同意済み
- CostGuardで投稿可能
- 連携済みActive X IDがある
- Active X IDが承認済み

結果:

- status = public
- scheduling_type = manual
- creator_id = Active X ID
- owner_discord_user_id = DiscordユーザーID

禁止:

- contact_x_id自由入力を主体にすること
- 未連携X IDを自動作成して即公開すること
- Active X IDなしで投稿すること

### 3-2. 枠あり投稿

- 未承認X IDでは枠確保のみ可能。
- 作品提出には承認済みActive X IDが必要。
- 作品は原則pending開始。
- 連続枠グループに紐づく場合は、グループ内枠をsubmittedへ更新する。

---

## 4. スロット設計

### 4-1. 予約グループ

`reservation_group_id` を使って連続枠をまとめる。  
同一グループには同じevent、同じDiscordユーザー、同じX IDの枠だけを含める。

### 4-2. 予約時

- 連続枠の候補を取得する。
- 全てavailableで、時間順に隣接していることを確認する。
- 上限を超えないことを確認する。
- 一部更新失敗時は、更新済み枠を戻す。

### 4-3. 部分解放

- 端解放: 残りは同一グループ。
- 中央解放: グループを左右に分割。
- 全解放: 全枠availableへ戻す。
- submitted枠は通常解放不可。

### 4-4. 拡張

- 前方隣接枠を追加可能。
- 後方隣接枠を追加可能。
- 中間空き枠を埋めて左右の同一主体グループを結合可能。
- 上限超過、時間重複、他ユーザー混在は禁止。

---

## 5. 部番号設計

### 5-1. ソート

1. start_timeあり
2. start_time昇順
3. end_time昇順
4. sort_order昇順
5. id昇順

### 5-2. 区切り

新しい部にする条件:

- 前枠終了から次枠開始までの差が、イベント設定の部区切り時間以上
- 日付が変わる
- slot_kindが変わる
- 明示的な区切りがある
- 時間なし枠へ移る

### 5-3. 部区切り時間

- イベントごとに設定可能。
- デフォルト30分。
- 未設定・異常値は30分。
- 管理画面で編集可能。
- 変更後は再計算。

---

## 6. チャプターコメント設計

### 6-1. データ

- id
- video_id
- x_user_id
- chapter_time
- chapter_label
- note
- visibility
- show_on_player_bar
- created_at
- updated_at

### 6-2. 投稿条件

- ログイン済み
- BANなし
- TOS同意済み
- CostGuardで投稿可能
- Active X IDあり
- Active X ID承認済み
- 対象動画がFlameNode内publicまたはunlisted

YouTube側unlistedでFlameNode内publicなら投稿可。

### 6-3. 表示

- publicは誰でも表示。
- privateは投稿者本人、作品作者、admin、許可運営者のみ。
- スマホでは動画下に表示。
- PCでは右レールまたは動画横に表示。

---

## 7. 公開API設計

### 7-1. 返却可

- public作品
- YouTube側unlistedだがFlameNode内public作品
- publicイベント
- publicクリエイター
- publicチャプターコメント
- publicメンバー情報
- 残り枠など公開してよい集計

### 7-2. 返却不可

- Discord ID
- email
- role
- is_banned
- TOS状態
- active_x_user_id
- linked_discord_user_id
- verification_token
- internal_note
- private note
- void_detail_private
- notification payload
- access_token
- refresh_token
- 管理者向け履歴

### 7-3. パフォーマンス

- limit上限
- page / offset
- キャッシュ
- 検索負荷対策
- 将来的な静的JSON化

---

## 8. health / security

healthはデータ整合性。securityは漏洩・権限・危険状態を検出する。

詳細なチェック項目はチェックリストに従う。
