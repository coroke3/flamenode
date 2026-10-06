# FlameNode Migration

> Status: Active
> Last verified: 2026-10-06
> Baseline commit: `99591f7b3387b6b33d113f2685d6b31e38085fdc`
> Scope: Next/OpenNext から Astro SSG + visibility gateway / React SPA / Hono へ段階移行し、同時に UI/UX redesign を production 化する。

このディレクトリは **長期移行タスクの状態と移行先仕様の正本**。現行挙動の正本は引き続き現行 code / test / Active docs とする。

## 入口

1. `PROGRESS.md` — 現在地、active task、直近の証拠
2. `WORK_ITEMS.md` — 実行順・依存関係・完了条件
3. active task が指定する現行 code/test/Active doc を必要な分だけ読む

全86画面の現行画面棚卸しは `../design-redesign/ROUTE_INVENTORY.md`、mock coverage は `../../app/(redesign)/dev/redesign/_catalog.ts` を正本とする。86件をこのディレクトリへ複製しない。

## 実行入口

| Agent | 1サイクル | 長時間継続 |
| --- | --- | --- |
| Claude Code | `/flamenode-migration` | `/loop /flamenode-migration`。引数なし `/loop` は `.claude/loop.md` を利用 |
| Antigravity | `/flamenode-migration` | `/loop`（workspace skill） |
| Codex | `$flamenode-migration` または skill selector | `/goal` でこの migration の完了条件を設定。`$loop` は1回以上の連続サイクル用補助 skill |

UI が `/flamenode-migration` をネイティブ展開しない場合でも、その文字列をユーザー指示として受けた agent は同名 skill / この README を入口として扱う。

## 絶対条件

- production の既存挙動を、対応する parity gate を通す前に置換しない。
- public は **SSR 0 / request中のHTML生成 0**。ただし visibility fence は request 時に確認する。
- visibility manifest が `enforce` で取得不能・不正なら fail closed を維持する。
- public→private の即時遮断を static artifact の鮮度へ依存させない。
- Astro build は D1 を直接読まず、safe public projection を private R2 build bucket 経由で読む。
- Server Action の業務ロジックは先に framework-neutral Domain Service へ抽出し、legacy Next と Hono が一時的に同じ実装を呼ぶ。
- Auth は UI/API と同時に全面移行しない。session/account-linking/role/banned/active X ID の互換 PoC 後に切り替える。
- 現在の Next コードを移行初期に `legacy/` へ物理移動しない。
- 実 production route 切替、Remote D1、secret、破壊的 migration は明示承認なしに実行しない。

## 完了の定義

移行全体を完了扱いにできるのは、`WORK_ITEMS.md` の cutover / cleanup まで完了し、86画面の coverage、feature parity、visibility、auth、API contract、smoke、rollback がすべて証拠付きで green のときだけ。

詳細は `ARCHITECTURE.md`、agent 間の運用は `AGENT_PROTOCOL.md`、棚卸しは `FEATURE_INVENTORY.md`、文書整理方針は `DOC_MAP.md` を参照する。
