---
name: pr-implementation-loop
description: "FlameNode の 1 PR 実装ループ：調査→実装→検証→次PR を型通りに回すプレイブック。"
---

# PR Implementation Loop

FlameNode の 1 PR 単位の実装を進めるプレイブック。
AGENTS.md の作業基本順序に準拠する。

## ループ手順

### Step 0: 準備
- AGENTS.md を読む
- 対象 PR の要件を明確にする
- 関連ファイル地図を作る (Glob + Grep)

### Step 1: 実装
- 1 PR で 1 テーマだけ触る
- Read → Edit のサイクルで実装する
- DB schema 変更がある場合は migration も作る

### Step 2: 検証
- `npm run typecheck 2>&1 | tail -30` を実行
- エラーがあれば修正して再実行
- `npm run build 2>&1 | grep -iE "error|warn|fail" | head -20` を実行
- 両方 pass するまで Step 1-2 を繰り返す

### Step 3: 確認
- 変更差分を確認 (`git diff`)
- 権限・DB整合性を再確認
- この PR が他の PR と衝突しないか確認

### Step 4: 次へ
- 次の PR テーマに進む
- セッションが長すぎる場合は handoff メモを残す

## 絶対禁止（各 PR で確認）
- フロントだけで権限を守ったことにする
- API直叩きで更新できる穴を残す
- Discord ID と X ID を混同する
- 未承認 X ID で投稿を許可する
- build/typecheck が通らない状態で次に進む

## タイプチェック/ビルドの推奨タイムアウト
- typecheck: 180000ms (3分)
- build: 300000ms (5分)
