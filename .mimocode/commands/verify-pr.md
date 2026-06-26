---
description: "Run typecheck and build verification for a FlameNode PR, filter errors, and report results."
---

# verify-pr

FlameNode の PR タイプチェック＆ビルド検証コマンド。
$ARGUMENTS で PR 番号や説明を渡すと、タスク名に反映される。

## 実行手順

1. **TypeScript typecheck** を実行する:

```sh
npm run typecheck 2>&1 | tail -30
```

2. エラーがあれば、対象ファイルを特定して修正する。修正後再実行。
3. **Next.js build** を実行し、エラー/警告をフィルタする:

```sh
npm run build 2>&1 | grep -iE "error|warn|fail" | head -20
```

4. 結果をまとめる:

```md
## 検証結果

- Typecheck: ✅ pass / ❌ fail (エラー数: N)
- Build: ✅ pass / ❌ fail (警告数: N)

### エラー詳細（ある場合）
| ファイル | 行 | 内容 |
|---|---|---|

### 修正内容（ある場合）
- [修正したファイル]: [何を直したか]
```

5. 両方 pass なら完了。fail ならエラー修正 → 1〜4 を再実行。

## 注意

- `npm run build` のタイムアウトは 300s (5分) を推奨。
- `npm run typecheck` のタイムアウトは 180s (3分) を推奨。
- build 出力が大量な場合は `grep` でフィルタしてから確認する。
- エラーが TS2322 (型割当) の場合は、型定義の整合を確認する。
- エラーが `no such column` の場合は、DB schema の migration が不足していないか確認する。
