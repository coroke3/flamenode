# FlameNode UI/UX Redesign

> Status: Proposal / mock only  
> Scope: `/dev/redesign` and this documentation only  
> Production UI/API/DB behavior: unchanged

## Goal

FlameNode Sans と既存機能を維持しながら、FlameNode を「機能は多いが、画面はシンプル」な状態へ再構成する。

今回の成果物は本番UIの置換ではない。`app/(redesign)/dev/redesign` に fixture-only のモックを置き、現在の全 `page.tsx` を次期UIの情報設計へ写像する。

## Mock

- Gallery: `/dev/redesign`
- Individual screen: `/dev/redesign/mock/[id]`
- Database: 使用しない
- R2 / KV / Queue / external API: 使用しない
- Authentication: 使用しない
- Production routes: 変更しない
- Theme: Light / Dark（Mock toolbar から確認可能）
- Target widths: 1440 / 1024 / 768 / 390px

## Coverage

対象 route group の `page.tsx` は 86 画面。Mock Gallery では以下に再分類する。

| Category | Screens | Role |
| --- | ---: | --- |
| Public | 16 | 作品・イベント・作者を探して見る |
| Personal | 6 | 自分の作業・作品・設定 |
| Entry | 3 | 参加・枠提出・通常投稿 |
| Manage | 12 | イベント現場運営 |
| Admin | 45 | サイト全体の管理コンソール |
| System | 4 | onboarding / auth / maintenance / UI surface |
| **Total** | **86** | |

Executable inventory は `app/(redesign)/dev/redesign/_catalog.ts`、人間向け一覧は `ROUTE_INVENTORY.md` を正本とする。

## Review order

1. `DESIGN_PRINCIPLES.md` — 判断基準
2. `UX_AUDIT.md` — 現行UIの問題
3. `NAVIGATION.md` — 情報設計
4. `/dev/redesign` — 全モック
5. `PAGE_COVERAGE.md` — 全画面・状態・responsive確認
6. `DECISIONS.md` — 採用/非採用判断

## Non-goals

- 本番ページの置換
- API、Server Action、DB schema、権限モデルの変更
- Cloudflare production deploy
- 現行受入仕様の削除
- 機能削減

既存の UI 受入要件は `docs/operations/ui-acceptance.md` を引き続き正本とし、このディレクトリは次期UI提案のみを扱う。
