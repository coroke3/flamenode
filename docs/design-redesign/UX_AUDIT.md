# UX Audit

現行UIを「機能を残したまま、判断・探索・入力をどこまで減らせるか」で再評価した。

## Executive findings

| Severity | Surface | Finding | Why it matters | Redesign response |
| --- | --- | --- | --- | --- |
| High | Public home | 作品より導入・イベント・棚構造が先に意識されやすい | 公開面の主役がUIになる | first viewportを新着作品へ寄せる |
| High | Dashboard | アカウント情報・status banner・KPIが「今やること」と競合 | 行動開始が遅い | Next Action → 締切 → 参加イベント → 作品 → stats |
| High | Entry | login/onboarding/X ID/枠/通常投稿の分岐が同時に現れる | 次の操作を判断させる | 期限付きの確保済み枠を最優先、次に受付イベント、通常投稿はsecondary |
| High | Manage | イベントごとに複数ボタンが並び、同じevent操作がsidebar/page/cardへ分散 | 運用時のクリック判断が増える | 1行1event + 1 primary action、event内は固定Tabs |
| High | Admin | 対応待ち・operationsがcard grid中心 | 高密度管理に対して比較・走査が遅い | queue/tableへ変更、異常を上に寄せる |
| Medium | Admin nav | 細かいgroupと直接linkが多い | sidebarを読む時間が長い | Content / Events / Users / Moderation / Operations / Systemへ統合 |
| Medium | Console | ADMIN/MANAGE説明bannerが毎回占有 | モードはURL/ナビから分かる | compact mode labelへ縮小 |
| Medium | Forms | pageごとのsection/cardが増えやすい | フォームごとに学習が必要 | field column + sticky/adjacent summaryの共通構造 |
| Medium | Mobile | desktop table/sidebarを縮めるだけでは操作密度が破綻する | 管理操作が困難 | sidebar→top tab rail、table row→label/value list |
| Low | Visual system | 既存tokenに10/14px radiusや複数shadowが残る | hierarchyが装飾依存になりやすい | redesignでは4/6/8px、shadow原則0 |

## Public

### Keep

- FlameNode Sans
- 作品サムネイル、作者、イベント紐付け
- Trending / Picks / Latest / Archive のデータそのもの
- event / creator / list の探索機能
- Light / Dark

### Improve

- 最初のviewportで作品を見せる。
- 各棚の説明文を常時表示しない。タイトルと必要な補助情報だけにする。
- Publicのprimary CTAは「見る」。サイト説明・参加説明はsecondaryへ下げる。
- イベント固有色は状態/見出しの小範囲だけに使う。

### Remove candidates

- 装飾目的の大型Hero
- 同じ作品情報の重複表示
- 「説明のためのカード」
- 意味の薄いeyebrow + title + descriptionの三段セット乱用

## Dashboard

現行は account header → onboarding/status → active slot → 4 KPI → X IDs → own works → collaboration → chapters の順。機能は正しいが、日常利用で最も重要な「今日何をするか」が統計や名義情報と競合する。

### Proposed order

1. Next Action
2. 締切・warning
3. 参加中event
4. 提出状態
5. 自分の作品
6. 通知
7. stats（quiet text）

KPIを削除するのではなく、意思決定に使わない数字を下部へ移す。

## Entry

Entryの正しい機能分岐は維持する。

- 未ログイン → login
- terms未完了 → onboarding
- X ID未承認 → 枠確保可能 / 投稿不可
- reserved slot → 提出
- active events → 枠確保
- unslotted → 通常投稿

問題は機能数ではなく、同時に見せる選択肢数。現在の状態から実行可能なprimary actionを1つに限定する。

## Manage

現行Manageは機能的には十分だが、event cardに「運営トップ / 審査 / 枠 / 公開ページ / 設定」などが並びやすい。これは運営者に毎回route選択を要求する。

### Proposed model

- `/manage`: event table。status / pending / problem / next actionだけ。
- `/manage/events/[id]`: event workspace。
- workspace tabs: Overview / Videos / Slots / Review / Audience / Staff / Settings。
- Notificationsはworkspace横断のglobal operation。
- event public pageはoverflow menuまたはsecondary text action。

## Admin

Adminは「見栄えの良いダッシュボード」ではなく管理コンソールとして扱う。

### Problems

- 1数値=1cardになると同時比較に弱い。
- 正常項目と異常項目が同じ面積を使う。
- 診断・運用・コンテンツ管理がsidebar上で同列に見える。
- Admin event operationとManage event operationが近く見える。

### Proposed model

- Home: priority inbox table → system summary。
- List: search/filter/status/table。
- Detail: definition list + related table + explicit danger zone。
- Create/Edit: common form shell。
- destructive actionは通常操作から物理的に離す。

## Information removal test

各要素について以下の順に判定する。

1. これがないと次の操作を誤るか。
2. これがないと状態を判断できないか。
3. 常時必要か。必要時だけ開けないか。
4. 既に別の近い場所へ同じ情報がないか。
5. text / spacing / dividerだけで表現できないか。

1〜2がNoなら削除または折りたたみ候補。3がNoなら常時表示しない。

## Strict review failures

以下が1つでも発生する画面は再修正対象。

- primary-looking CTAが2つ以上ある
- sectionの半数以上がcard container
- card inside card
- normal statusがwarningと同じ視覚重量
- page titleよりhelper copyが長い
- desktop tableを390pxで単純縮小
- sidebarに同じ概念のlinkが複数groupへ存在
- Publicでviewport内に作品がない
- DashboardでNext Actionよりstatsが上
- Manageで1 event rowに3つ以上の常時button
- Adminで検索対象一覧をcard grid表示
