# Navigation

## Navigation model

URLをそのままside navigationへ列挙しない。ユーザーが「何を管理するか」で分類する。

## Public

Primary navigation:

```text
FlameNode     作品   イベント   クリエイター                     Account
```

補助:

- About
- Rules
- Groups
- Trending / Recommend は作品探索文脈から遷移

Public headerに管理機能を露出しない。ログイン後も作品閲覧のheader密度は大きく変えない。

## Personal

起点は `/dashboard`。

```text
Dashboard
  ├─ Next Action → Entry / edit
  ├─ My works → edit
  ├─ Library
  └─ Account → settings
```

投稿は `/entry` を明確な行動導線として残す。Settings / playlist等を同格のglobal navigationに並べない。

## Entry

`/entry` はnavigationというよりrouterとして扱う。

優先順位:

1. reserved + not submitted
2. active event entry
3. normal post

`/entry/slotted` と `/entry/unslotted` はform contextを維持し、途中で別の投稿方式へ誘導しない。

## Manage

### Global

```text
MANAGE
Workspace
  Overview
  Notifications

Events
  PVSF 2026 Autumn
  Motion Relay
  …
```

### Event workspace

```text
Overview / Videos / Slots / Review / Audience / Staff / Settings
```

`YouTube Playlist` はVideosまたはSettings配下のsecondary operationとして扱い、global event tabに常時出す必要はない。

`Public page` はcontext actionであり、main navigationではない。

## Admin

現行の多数groupを6分類へ整理する。

### Content

- Videos
- Announcements
- YouTube sync
- Playlist sync

### Events

- Events
- Event groups
- Templates

Adminのevent detailは全体管理・作成・権限付与・設定確認に寄せる。日常の枠/審査/参加者運用はManageへリンクする。

### Users

- Users / X IDs
- X link requests
- X ID merges
- Permission simulator

### Moderation

- Pending videos（shortcut/filter）
- Moderation cases

### Operations

- Notifications
- Audit
- History
- Static builds
- YouTube quota
- Cost guard

### System

- Health
- Integrity
- Workers
- Security
- API endpoints
- Legacy import
- Spreadsheet（feature enabled時）
- Rules（system policyとして扱う場合。Contentへ置く選択も可）

## Sidebar rules

- Group titleは6個前後まで。
- 1groupが7項目を超える場合は頻用項目だけsidebarへ出し、残りはgroup landingへ寄せる。
- 現在地はtext + backgroundで示す。iconだけで示さない。
- 同じrouteを複数groupへ置かない。filter済みshortcutは例外だが、親routeとの関係を明示する。
- Mode説明の大きなbannerをsidebar先頭に常設しない。`ADMIN` / `MANAGE` labelで十分。

## Mobile

### Public / Personal

headerはブランド + primary context + account。navigationは必要時にmenu。

### Manage / Admin

Desktop sidebarを縦積みしない。

- mode label
- 現在event / section
- horizontal tab rail または accessible drawer
- page local filters

Mockではhorizontal railを採用。production化時は項目数とキーボード操作を確認してdrawerとの比較検証を行う。

## Route consolidation candidates

機能削除ではなくnavigation上の統合候補。

| Current routes | Navigation proposal |
| --- | --- |
| `/manage/events/[id]/*` | 1 event workspace + tabs |
| `/admin/events/[id]/slots`, `/staff` | Admin event detailからManageへ明確にhandoff |
| `/admin/youtube-sync`, `/playlists`, `/youtube-quota` | Operations / Content内でYouTube groupとして近接 |
| `/admin/audit`, `/history` | Operations内でAudit groupとして近接 |
| `/admin/health`, `/health/integrity`, `/workers`, `/security` | System内で近接 |
| `/dashboard/settings`, `/youtube-playlists` | Account / secondary navigation |
