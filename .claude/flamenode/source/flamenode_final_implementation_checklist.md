# FlameNode 実装チェックリスト・最終版

## 0. PR基本

- [ ] 目的が明確
- [ ] 関連Issueがある
- [ ] DB変更の有無が明記されている
- [ ] 権限変更の有無が明記されている
- [ ] UI変更の有無が明記されている
- [ ] 破壊的変更の有無が明記されている

---

## 1. ID / 権限

- [ ] Discord IDとX IDの責務が混ざっていない
- [ ] Active X ID切替で対象データが切り替わる
- [ ] いいね/セーブ/ライブラリがX ID単位
- [ ] owner_discord_user_idだけで編集許可していない
- [ ] 未承認X IDは枠確保のみ
- [ ] BAN/TOS/CostGuardが書き込み操作に効く
- [ ] UI disabledだけでなくサーバー側でも拒否している
- [ ] CurrentUserまたは共通ContextでTOS状態を見られる

---

## 2. 投稿

- [ ] 枠なし投稿は連携済みActive X ID必須
- [ ] 枠なし投稿は承認済みX ID必須
- [ ] 枠なし投稿は条件を満たせば即public
- [ ] contact_x_id自由入力で即公開できない
- [ ] 未連携X IDを自動作成して即公開しない
- [ ] 枠あり提出は承認済みActive X ID必須
- [ ] 未承認X IDでは枠確保のみ可能
- [ ] YouTube IDはURLではなくIDとして保存される
- [ ] YouTube側unlistedでもFlameNode内publicなら通常公開扱い

---

## 3. 編集フォーム

- [ ] セクションごとに編集可否が分かれる
- [ ] 権限がないセクションは見た目で分かる
- [ ] フィールド単位でサーバー側権限チェックがある
- [ ] YouTube ID変更は重複チェックがある
- [ ] X ID自由入力で権限を壊せない
- [ ] 候補検索で古いユーザーも探せる

---

## 4. スロット

- [ ] 連続枠にreservation_group_idが付く
- [ ] 連続予約失敗時に更新済み枠を巻き戻す
- [ ] グループ内に別ユーザーが混在しない
- [ ] グループ内に別X IDが混在しない
- [ ] 中央部分解放でグループが分割される
- [ ] 隣接拡張でグループが結合される
- [ ] 上限超過が拒否される
- [ ] 時間重複が拒否される
- [ ] submitted枠が通常解放されない
- [ ] 表示はグループ単位
- [ ] 管理画面で個別枠も確認できる

---

## 5. 部番号

- [ ] イベントごとに部区切り時間を設定できる
- [ ] デフォルト30分
- [ ] 異常値は30分にフォールバック
- [ ] 時系列順で部番号が算出される
- [ ] 前方追加で部番号が再計算される
- [ ] 日付変更で部が分かれる
- [ ] 休憩閾値で部が分かれる
- [ ] 時間なし枠の扱いが定義されている
- [ ] 管理画面で算出根拠を確認できる

---

## 6. チャプターコメント

- [ ] 独立コメント欄がない
- [ ] video_commentsを新規利用していない
- [ ] コメントは必ず時刻に紐づく
- [ ] noteが本文として扱われる
- [ ] 返信・スレッドを作っていない
- [ ] 未承認X IDでは投稿不可
- [ ] BAN/TOS/CostGuardが効く
- [ ] public/unlisted以外には投稿不可
- [ ] YouTube側unlistedかつFlameNode内publicには投稿可
- [ ] private表示範囲が守られている
- [ ] marker_kindに依存した分岐を増やしていない

---

## 7. DB

- [ ] deprecated項目へ新規書き込みしていない
- [ ] video_commentsを使っていない
- [ ] outro_commentを新規利用していない
- [ ] primary_event_idとvideo_eventsが同期される
- [ ] system_settingsはglobal 1行
- [ ] 削除は論理削除・アーカイブ優先
- [ ] 監査ログが必要操作で残る

---

## 8. 公開API

- [ ] publicな作品だけ返す
- [ ] YouTube側unlistedでFlameNode内publicの作品は返す
- [ ] Discord IDを返していない
- [ ] emailやroleを返していない
- [ ] private/internal noteを返していない
- [ ] ページネーションがある
- [ ] limit上限がある
- [ ] キャッシュ戦略がある

---

## 9. health

- [ ] system_settingsがglobal 1行
- [ ] primary_event_idとvideo_eventsが同期
- [ ] 存在しないevent/video参照がない
- [ ] available slotにvideo_idがない
- [ ] submitted slotにvideo_idがある
- [ ] slot時間重複がない
- [ ] reservation_group_id内に別ユーザー混在がない
- [ ] public動画にyoutube_video_idがある
- [ ] voided動画が公開されない
- [ ] like_countと実数が大きくズレていない
- [ ] deprecated項目に新規データが増えていない

---

## 10. security

- [ ] accounts.access_tokenがnull
- [ ] rejected X IDがactiveでない
- [ ] 未承認X IDで投稿済み作品がない
- [ ] BANユーザーの書き込みがない
- [ ] TOS未同意ユーザーの書き込みがない
- [ ] 公開APIに内部情報が出ていない
- [ ] custom pageで危険HTMLが無効化される
- [ ] 管理操作がhistory_logsに残る

---

## 11. UI / UX

- [ ] 上部バーの情報量が整理されている
- [ ] X ID切替はアクセスしやすい
- [ ] テーマ切替はアクセスしやすい
- [ ] エントリーページは2択中心
- [ ] スロット確保ボタンが直接確保画面へ飛ぶ
- [ ] トップページに開催日時がある
- [ ] トップページに募集期間がある
- [ ] トップページに残り枠がある
- [ ] 文言が自然
- [ ] 行高が揃っている
- [ ] 狭い幅でも崩れない
- [ ] 編集可能箇所が分かる
- [ ] 編集不可箇所が分かる

---

## 12. マージ前最終確認

- [ ] typecheckが通る
- [ ] buildが通る
- [ ] DB migrationがローカルで通る
- [ ] 権限なしユーザーでAPI直叩きテスト済み
- [ ] X ID切替テスト済み
- [ ] 連続枠の部分解放テスト済み
- [ ] 連続枠の拡張テスト済み
- [ ] 部番号再計算テスト済み
- [ ] チャプターコメント投稿テスト済み
- [ ] 公開APIの漏洩チェック済み
- [ ] health/securityチェック済み
