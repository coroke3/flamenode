# FlameNode 旧データ互換・入力補助設計

## 1. 目的

旧データ形式、過去イベント情報、名前・X ID 相互変換、CSV 入力補助を FlameNode 内で扱うための仕様をまとめる。外部の HTML や JSON 参照資料がなくても、この設計だけで実装できる状態にする。

## 2. `eventinfo.json` 互換仕様

### 2-1. データ形

`eventinfo.json` はイベント配列で、1要素が1イベントを表す。

```json
[
  {
    "eventid": "PVSF2026Sp",
    "start": "2026-03-27T18:00:00.000Z",
    "end": "2026-03-29T23:59:00.000Z",
    "type": "event",
    "icon": "https://drive.google.com/open?id=11Ks00gwNJZyvKWih3Xcf9StArJsW48eo",
    "eventname": "PVSF2026Sp",
    "member": "Mochi,あおね,おたこ",
    "memberid": "coroke3,hs_nozomizo13,012345rty",
    "menberpost": "主催,音楽,告知画像",
    "explanation": "映像連続投稿祭",
    "img": "https://i.gyazo.com/example.png"
  }
]
```

### 2-2. フィールド対応

| 旧キー | FlameNode 保存先 | 仕様 |
| :--- | :--- | :--- |
| `eventid` | `events.id` | イベント一意キー。空白を除去する。 |
| `eventname` | `events.title` | イベント表示名。文字化け疑いはハイライトし、手動修正またはスキップを選べる。 |
| `type` | `events.event_type` | `event`, `collabo`, `type`, `other` に正規化する。 |
| `start` | `events.start_time` | ISO 8601 を UNIX タイムスタンプへ変換する。 |
| `end` | `events.end_time` | 空文字なら NULL。 |
| `icon` | `events.icon_url` | Google Drive URL は直リンク化する。 |
| `img` | `events.img_url` | バナー画像URL。Drive 以外は原則そのまま保持し、Cloudflare/R2 へ再保存しない。 |
| `explanation` | `events.explanation` | イベント説明。 |
| `member` | `x_users.x_name` / 表示名 | カンマ区切りで `memberid` と同じ順番に対応する。 |
| `memberid` | `event_editors.x_user_id` | `@` を除去し、`x_users` にも登録する。 |
| `menberpost` | `event_editors.public_role_label` | 旧データの誤字キー。互換のため正式に受け付ける。 |
| `memberpost` | `event_editors.public_role_label` | 正表記キー。`menberpost` と同時にある場合はこちらを優先する。 |

## 3. 文字化け検出と修正

### 3-1. 検出条件

以下を含む場合は文字化け疑いとして扱う。

- `縺`, `譁`, `荳`, `蜷`, `螟`, `�` など Mojibake の典型文字
- 制御文字や不可視文字

文字化け修正は必須にしない。プレビュー画面では候補を補助表示し、管理者が手動修正するか、一括スキップして原文のまま取り込むかを選べる。
- 日本語欄に極端に不自然な記号列が連続する文字列

### 3-2. 修正フロー

- UTF-8、Shift_JIS、Windows-31J の取り違え候補は補助情報として生成してよい。
- 候補が自然に見える場合でも自動修復・自動反映はしない。
- 原文、候補、手動修正欄を横並びで表示する。
- 管理者が手動で修正し、確認済みにしてから保存できる。
- 未修正または未確認の疑い行はスキップまたは下書き保存に留める。

## 4. 名前・X ID 相互変換

### 4-1. 入力形式

- 名前、X ID、またはカンマ区切りの複数値を受け付ける。
- 先頭の `@` は比較時に除去する。
- 表計算ソフトから縦に貼り付けられたデータは、空行を除いてカンマ区切りへ変換できる。

### 4-2. 参照データ

候補生成には以下を使う。

- `x_users.id`
- `x_users.x_name`
- `x_user_aliases.alias_x_id`
- `video_members.name`
- `video_members.x_user_id`
- 旧 `video.json` 由来の `creator` / `tlink`
- 旧 `video.json` 由来の `member` / `memberid`
- `event_editors.x_user_id`
- `event_collaborator_permissions.x_user_id`

### 4-3. 候補生成

- `creator` と `tlink` は1対1候補として登録する。
- `member` と `memberid` はカンマ区切りで分割し、同じインデックス同士を候補化する。
- `member` と `memberid` の数が合わない場合、存在するペアだけ候補化し、不足分は未確定候補として表示する。
- 同じ `name + id` の候補は1件に重複排除する。

### 4-4. 類似度

- レーベンシュタイン距離を使う。
- `similarity = (1 - distance / longer_length) * 100` で算出する。
- 30%以下は候補から除外する。
- 50%未満は低信頼、50%以上80%未満は要確認、80%以上は高信頼として表示する。
- 完全一致が1件だけなら自動選択する。高信頼候補が複数ある場合は自動確定しない。

## 5. CSV インポート

### 5-1. 共通方針

- CSV は追記のみを基本動作にする。
- 既存行と同じ X ID や同じ名前がある場合も自動更新しない。
- 重複候補はプレビューで警告し、「取り込まない」または「警告しつつ追記」を行ごとまたは一括で選べるようにする。
- CSV 作成プロンプトをコピーするボタンを各入力欄に置く。
- Googleフォーム等で集めた作品、イベント、スロット、イベント情報も、対象タブごとの列定義に沿って取り込めるようにする。

### 5-2. イベント協力者権限 CSV

| 列 | 必須 | 説明 |
| :--- | :---: | :--- |
| `event_id` | 必須 | 対象イベント ID |
| `display_name` | 必須 | 管理画面での協力者名 |
| `x_user_id` | 条件付き | X ID。`discord_user_id` がない場合は必須 |
| `discord_user_id` | 条件付き | Discord ユーザー ID。`x_user_id` がない場合は必須 |
| `permission_key` | 必須 | 1行につき1権限 |
| `is_public_staff` | 任意 | 公開運営メンバーとして表示するなら1 |
| `public_role_label` | 任意 | 公開役職名 |

`permission_key` は次のいずれかを使う。

- `event.basic`
- `event.slots`
- `event.members`
- `event.questions`
- `videos.title`
- `videos.music_credit`
- `videos.members`
- `videos.review_data`
- `videos.youtube_id`
- `videos.primary_event`

`collaborators.manage` はイベント協力者には付与できない。協力者管理はイベント編集許可者以上が管理画面で行う。

## 6. 旧形式エクスポート

- 通常エクスポートは公開データのみを含める。
- 管理者向け詳細エクスポートは限定公開・非公開・管理画面専用メンバーも含められる。
- `x_reapply_required` 作品は公開ページでは「調整中」として扱えるが、旧形式エクスポートの上映順・連続再生対象からは除外する。管理者・運営向け詳細レポートには状態フラグ付きで出力できる。
- `voided` 作品は通常エクスポート、管理者向け詳細エクスポート、スコア・上映順から除外する。監査・統計専用の別レポートにのみ出力し、通常の旧形式データへ混ぜない。
- `eventinfo.json` 互換出力では、互換性のため `menberpost` を必ず含め、必要なら `memberpost` も併記する。
- `video.json` 互換出力では、`member` と `memberid` を `video_members.order_index` 順にカンマ区切りで出力する。
- 旧形式出力の文字コードは UTF-8 固定にする。

## 6-1. アーカイブと旧データの公開補助

- 外部画像URLは Cloudflare へ保存せず参照のみで維持する。
- 運営メンバー公開範囲が旧データから判断できない場合は、非公開（管理画面のみ）を既定にする。
- 時間情報がない旧枠は時間なしスロットとして連番で取り込む。
- 旧データ内の X ID は未承認 X ID（プレースホルダー）として作成し、将来の本人確認・統合・付け替えに備える。
- アーカイブの名義修正履歴は公開ページには表示せず、最新名だけを表示する。
