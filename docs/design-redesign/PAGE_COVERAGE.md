# Page Coverage

## Route coverage

`ROUTE_INVENTORY.md` と `_catalog.ts` の対象は 86 / 86 pages。

| Category | Normal mock | Count |
| --- | --- | ---: |
| Public | Yes | 16 |
| Personal | Yes | 6 |
| Entry | Yes | 3 |
| Manage | Yes | 12 |
| Admin | Yes | 45 |
| System | Yes | 4 |
| **Total** | **Yes** | **86** |

各画面は専用URL `/dev/redesign/mock/[id]` を持つ。完全に個別componentを86個作るのではなく、同じ役割の画面は同じlayout primitiveを共有し、page title / purpose / primary action / fixture contextをroute catalogから差し替える。

## State coverage

全状態を全ページへ機械的に作らない。操作判断が変わる状態だけをState Labに出す。

| Surface | Normal | Empty | Loading | Error | Disabled | Permission denied | Success | Warning / degraded |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Public home | Yes | — | reflection pending | data unavailable | — | — | — | degraded |
| Public lists | Yes | Yes | Yes | Yes | — | — | — | when relevant |
| Public detail/profile/info | Yes | — | — | — | — | — | — | — |
| Dashboard | Yes | Yes | Yes | Yes | — | — | — | Next Action warning |
| Entry landing | Yes | Yes | Yes | Yes | — | — | — | reserved deadline |
| Entry forms | Yes | — | — | Yes | Yes | — | Yes | validation |
| Personal forms | Yes | — | — | Yes | Yes | — | Yes | validation |
| Manage dashboard/list/event | Yes | Yes | Yes | Yes | — | Yes | — | issue band |
| Manage forms | Yes | — | — | Yes | Yes | Yes | Yes | validation |
| Admin dashboard/table | Yes | Yes | Yes | Yes | — | Yes | — | priority queue |
| Admin forms | Yes | — | — | Yes | Yes | Yes | Yes | destructive warning |
| System | Yes | — | Yes where relevant | Yes | — | — | Yes where relevant | maintenance |

State Lab は本番画面の一部ではなく、mock viewportの外側に置くレビュー領域。本番化時は状態ごとに実際の条件へ接続する。

## Responsive coverage

### 1440px

- Public: 4-column work grid
- Personal: wide content + compact actions
- Manage/Admin: sidebar + content
- Forms: fields + summary side column
- Lists: row/table densityを優先

### 1024px

- Public work grid: 3-column
- Manage/Admin sidebar幅を縮小
- filter / table / review previewが欠けない
- form summaryをside column維持可能な範囲で維持

### 768px

- Manage/Admin sidebar → horizontal navigation rail
- Tabs → horizontal scroll
- Work grid → 2-column
- Form → 1-column、summaryを後段へ
- Detail two-column → 1-column

### 390px

- Work gridは2-columnを維持し、title/metaを短くする
- Table row → labeled key/value list
- Filter → full-width vertical controls
- Primary buttonはheading直下またはsection内へ移動
- Event strip / action row → stacked but priority order維持
- Page全体のhorizontal overflow禁止

現行受入基準には360/430/640/1280/1920もあるため、本番移植時は既存 `docs/operations/ui-acceptance.md` の全幅へ拡張して検査する。

## Theme coverage

- Light: existing light tokens
- Dark: existing dark tokens
- Same DOM / same order / same density
- Themeでlayoutを分岐しない
- FlameNode Sansは両themeで同じ用途

Mock toolbarで Light / Dark / System を切替可能。Systemは確認補助であり、設計対象として要求されるLight/Darkは両方同一layoutで成立させる。

## Interaction coverage

Mockで確認するもの:

- primary / secondary / text action hierarchy
- filter placement
- event tabs
- table-to-mobile-row transformation
- sidebar-to-mobile-rail transformation
- form field/summary ordering
- theme switching

Mockで接続しないもの:

- auth
- permission resolver
- DB mutation
- API
- R2/KV/Queue
- notification send
- slot reserve/submit
- YouTube sync

これらは現行機能を削除したのではなく、fixture-onlyというモック境界のため未接続。

## Final visual review checklist

各mockを1440 / 1024 / 768 / 390、Light / Darkで確認し、以下がYesなら修正する。

- cardが多すぎる
- radiusが多すぎる
- colorが多すぎる
- buttonが多すぎる
- helper textが長い
- same informationが重複
- sidebarが複雑
- primary CTAが競合
- scroll量が目的に対して長い
- first viewportで判断できない
- mobileでtable/filter/tabsが操作しづらい
- Adminで装飾が情報密度を下げる
- PublicでUIが作品より目立つ
