# Phase 6: 公開API・health・security

## 目的

公開APIの返却項目をホワイトリスト化し、内部情報漏洩を防ぐ。管理画面にDB整合性チェックとセキュリティ点検を用意する。

## 推奨モデル

- 実装: Sonnet
- 公開API漏洩レビュー、security判断: Opus

## 対応要求ID

J-13、N-1〜N-6、E-1〜E-6、P-4、P-5、M-2、M-5、L-2

## 公開API返却可

- public作品
- YouTube側unlistedだがFlameNode内public作品
- publicイベント
- publicクリエイター
- publicチャプターコメント
- publicメンバー情報
- 残り枠など公開してよい集計

## 公開API返却不可

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

## API要件

- 返却項目はホワイトリスト化する。
- limit上限を持つ。
- page / offset を持つ。
- キャッシュ戦略を持つ。
- 検索負荷対策を行う。
- APIキー管理は作る。スコープ、レート制限、有効期限を含める。

## healthチェック

- system_settingsがglobal 1行
- primary_event_idとvideo_eventsが同期
- 存在しないevent/video参照がない
- available slotにvideo_idがない
- submitted slotにvideo_idがある
- slot時間重複がない
- reservation_group_id内に別ユーザー混在がない
- public動画にyoutube_video_idがある
- voided動画が公開されない
- like_countと実数が大きくズレていない
- deprecated項目に新規データが増えていない

## securityチェック

- accounts.access_tokenがnull
- rejected X IDがactiveでない
- 未承認X IDで投稿済み作品がない
- BANユーザーの書き込みがない
- TOS未同意ユーザーの書き込みがない
- 公開APIに内部情報が出ていない
- custom pageで危険HTMLが無効化される
- 管理操作がhistory_logsに残る

## 実装前に出す計画

```md
# Phase 6 実装計画

## 変更対象ファイル

## 公開API一覧
| API | 現行返却項目 | 修正後返却項目 | 漏洩リスク |
|---|---|---|---|

## healthチェック設計

## securityチェック設計

## APIキー管理設計

## Dry Run / 修復操作方針

## Opus判断が必要な箇所

## テスト計画
```

## 実装後チェック

- [ ] Discord IDを返していない
- [ ] emailやroleを返していない
- [ ] private/internal noteを返していない
- [ ] ページネーションがある
- [ ] limit上限がある
- [ ] キャッシュ戦略がある
- [ ] healthチェックが実装済み
- [ ] securityチェックが実装済み
- [ ] 管理操作がhistory_logsに残る

## PR名

- `api/public-whitelist`
- `admin/health-security`
