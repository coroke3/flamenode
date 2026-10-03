# Design System

次期UIモックは新しい独立ブランドを作らず、既存tokenと FlameNode Sans を整理して使う。

## Typography

| Role | Font | Use |
| --- | --- | --- |
| Brand | `var(--font-brand)` / FlameNode Sans | Logo / brand |
| Heading | `var(--font-brand)` | H1–H3 |
| UI label | FlameNode Sans or body | short action / tab / count |
| Number | FlameNode Sans / mono when technical | KPI / status count |
| Body | `var(--font-body)` | paragraph / description |
| Technical | `var(--font-mono)` | URL / ID / log / API |

原則: FlameNode Sansで長文を埋めない。

## Color roles

新しい色名を増やさず以下へ集約する。

| Role | Existing token direction |
| --- | --- |
| Background | `--bg-base` |
| Surface | `--bg-surface` |
| Raised / inset | `--bg-elevated` only when needed |
| Text | `--text-primary` |
| Muted | `--text-muted` |
| Border | `--border-subtle`, `--border-strong` |
| Accent | `--accent-primary` |
| Danger | `--danger` |
| Warning | `--accent-warning` |
| Success | `--ok` |

Event colorは局所accentのみ。page backgroundや大量cardをevent colorで染めない。

## Radius

Redesignで使うradiusは原則:

- 4px: thumbnail / input / status
- 6px: button / compact surface
- 8px: 意味のある大きめsurfaceの上限

10px / 14px / large pillは次期UIでは新規利用しない。pillはtag / status / account / filterに意味がある場合のみ。

## Shadow

標準surfaceでは `box-shadow: none`。

shadowを許可するのはmodal / drawer / overlayの分離がborderだけでは不十分な場合のみ。

## Spacing

4px単位を基本にし、主要spacingは:

- 4: micro gap
- 8: label/control
- 12: compact row
- 16: standard row
- 24: section internal
- 32: small section
- 48: major section
- 64+: page separation only

装飾目的で大きな空白を作らない。

## Core components

ページ専用componentより以下のprimitiveを優先する。

- Button
- Input
- Select
- Textarea
- Tabs
- Status / Badge
- Table / RowList
- Dialog
- Dropdown
- Tooltip
- Toast
- Sidebar / Mobile navigation
- Header
- DefinitionList
- EmptyState

`EventSomethingCard` のような専用cardを作る前に Table row / DefinitionList / standard surfaceで成立するか確認する。

## Buttons

### Primary

- 1画面1つを原則
- accent fill
- destructive actionには使わない

### Secondary

- border only
- primaryと同等の視覚重量にしない

### Text action

- 一覧行の「開く」「詳細」「すべて見る」
- iconは不要なら付けない

### Danger

- destructive area内のみ
- confirmation必須
- normal action群から距離を取る

## Status

statusは `text + restrained border/background`。

Normal / Active / Public は弱く表示。Warning / Error / Permission issueだけを強める。

## Tables and row lists

Desktop:

```text
Object                Status      Updated      Action
Afterimage             Public      10/03        Open
```

Mobile:

```text
Object   Afterimage
Status   Public
Updated  10/03
Action   Open
```

390pxで横方向へページ全体を押し広げるtableは禁止。列が重要で横比較が必須の場合だけtable内部scrollを許可する。

## Forms

Desktop:

```text
Fields                         Summary
--------------------------     --------
field                          status
field                          update
field                          primary action
```

MobileではSummaryをfield群の後ろへ移動する。

- labelはinputの直上
- helper textは必要時のみ
- validationはfieldの直下
- submitは1つ
- success後は次行動を1つ示す

## Navigation

### Public

作品 / イベント / クリエイターを基本。補助ページはfooterまたはcontext link。

### Personal

Dashboardを起点にし、投稿はPrimary、設定はaccount menuへ。

### Manage / Admin

別workspaceとして視覚・情報設計を分離する。URLと権限だけでなくnavigation vocabularyでも混在させない。

## Motion

許可:

- hover / focus
- dropdown
- dialog / drawer
- state change

禁止:

- floating
- parallax
- glow animation
- background animation
- 意味のないauto animation

`prefers-reduced-motion` を尊重する。

## Accessibility

- color-only status禁止
- focus visible維持
- touch targetは44pxを基準（compact console rowで別途十分なclick areaを確保）
- dialog focus trap
- drawer Escape / backdrop / close対応
- heading orderを崩さない
- text contrastは既存theme tokenの検証対象

## Light / Dark

モックは同一DOM / 同一densityで既存theme tokenに追従する。Dark専用component、Light専用layoutは作らない。
