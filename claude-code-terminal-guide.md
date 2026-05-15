# Claude Code 初心者向けターミナル実行ガイド

作成日: 2026-05-15
対象リポジトリ: `coroke3/flamenode`
関連正本: `CLAUDE.md` / `claude-code-subagent-assignment.md` / `.claude/flamenode/README.md`

このファイルは、Claude Codeを使ったことがない人でも、ターミナルからFlameNode修正作業を安全に始められるようにするための実行手順である。

今回のFlameNode修正では、命令ファイルをClaude Codeが読みやすいように分割している。作業者はこのガイドに沿って、まず調査、次に計画、最後に小さなPR単位で実装する。

---

## 0. 今回の命令ファイル構成

Claude Codeは、リポジトリ内の以下のファイルを使って作業する。

```text
CLAUDE.md
claude-code-subagent-assignment.md
claude-code-terminal-guide.md
.claude/flamenode/README.md
.claude/flamenode/requirements-map.md
.claude/flamenode/source/
.claude/flamenode/phases/
.claude/agents/
.claude/commands/
```

それぞれの役割:

| ファイル/ディレクトリ | 役割 |
|---|---|
| `CLAUDE.md` | Claude Codeが最初に読むプロジェクト指示 |
| `claude-code-subagent-assignment.md` | 全体仕様・モデル割当・禁止事項の正本 |
| `.claude/flamenode/README.md` | 分割命令セットの入口 |
| `.claude/flamenode/requirements-map.md` | 4原典の要求ID A〜Q を実装照合しやすくした表 |
| `.claude/flamenode/source/` | 4原典のうち詳細設計・チェックリスト・矛盾精査の原典コピー |
| `.claude/flamenode/phases/` | Phase 0〜9の実行単位ごとの命令 |
| `.claude/agents/` | Claude Codeのプロジェクト用サブエージェント定義 |
| `.claude/commands/` | `/flamenode-plan` や `/flamenode-review` などのプロジェクト用コマンド |

作業時の基本入口は次の3つ。

```sh
cat CLAUDE.md
cat .claude/flamenode/README.md
cat .claude/flamenode/requirements-map.md
```

---

## 1. 公式仕様上の前提

Claude Codeでは、プロジェクト用のカスタムコマンドを `.claude/commands/` に置ける。今回のリポジトリでは、`/flamenode-plan` と `/flamenode-review` を用意している。

また、プロジェクト用サブエージェントは `.claude/agents/` に置ける。今回のリポジトリでは、調査用・実装用・上級レビュー用のエージェントを用意している。

今回追加済みの主なClaude Code用ファイル:

```text
.claude/commands/flamenode-plan.md
.claude/commands/flamenode-review.md
.claude/agents/flamenode-repo-cartographer.md
.claude/agents/flamenode-implementation-agent.md
.claude/agents/flamenode-architecture-reviewer.md
```

---

## 2. 前提環境

Claude Codeの利用には、基本的に以下が必要。

- Node.js 18以上
- npm
- Git
- インターネット接続
- macOS / Linux / Windowsの場合はWSLなどのターミナル環境

Mac利用者は、標準のターミナル、iTerm2、VS Codeのターミナルのどれでもよい。

---

## 3. Node.js と npm の確認

まずターミナルを開く。

```sh
node --version
npm --version
```

Node.jsが18以上ならOK。

例:

```text
v20.11.1
10.2.4
```

Node.jsが入っていない、または18未満の場合は、Node.jsをインストール・更新する。

MacでHomebrewを使う場合:

```sh
brew install node
```

すでに入っている場合:

```sh
brew upgrade node
```

確認:

```sh
node --version
npm --version
```

---

## 4. Claude Code のインストール

標準インストール:

```sh
npm install -g @anthropic-ai/claude-code
```

`sudo npm install -g ...` は避ける。権限トラブルの原因になりやすい。

インストール確認:

```sh
claude --version
```

状態確認:

```sh
claude doctor
```

Claude Code内でも `/doctor` を使える。

アップデート:

```sh
claude update
```

---

## 5. Claude Code にログインする

初回起動:

```sh
claude
```

ブラウザ認証を求められたら、画面の案内に従ってログインする。

ログイン後、ターミナルに戻ってClaude Codeが起動すればOK。

Claude Code内で状態を確認したい場合:

```text
/status
```

アカウントを切り替える場合:

```text
/login
```

---

## 6. FlameNode リポジトリを取得する

任意の作業ディレクトリへ移動する。

例:

```sh
cd ~/Documents
mkdir -p projects
cd projects
```

GitHubからcloneする。

```sh
git clone https://github.com/coroke3/flamenode.git
cd flamenode
```

すでにclone済みの場合:

```sh
cd ~/Documents/projects/flamenode
git checkout main
git pull origin main
```

現在地確認:

```sh
pwd
ls
```

`package.json`、`README.md`、`CLAUDE.md`、`claude-code-subagent-assignment.md`、`.claude/` が見えればOK。

---

## 7. FlameNode の依存関係を入れる

```sh
npm install
```

`.dev.vars` が必要な場合:

```sh
cp .dev.vars.example .dev.vars
```

値が必要な環境変数は、実運用の秘密情報を勝手に作らず、管理者から受け取る。

---

## 8. 作業ブランチを作る

いきなり `main` で作業しない。

まず最新化する。

```sh
git checkout main
git pull origin main
```

最初は調査用ブランチで試す。

```sh
git checkout -b docs/claude-code-plan
```

実装PRの場合の例:

```sh
git checkout -b auth/id-write-guard
```

推奨PR分割は `.claude/flamenode/README.md` と `claude-code-subagent-assignment.md` に書いてある。

---

## 9. Claude Code をプロジェクトで起動する

リポジトリのルートで起動する。

```sh
claude
```

最初に、Claude Codeがリポジトリの指示を読める状態か確認する。

Claude Code内で次を入力する。

```text
/status
```

必要なら、現在のモデルを確認・変更する。

```text
/model
```

---

## 10. まず `/flamenode-plan` を実行する

今回の構成では、初心者は手入力プロンプトよりもプロジェクト用コマンドを使う方が安全。

Claude Code内で次を入力する。

```text
/flamenode-plan
```

このコマンドは、以下を読ませるためのコマンドである。

- `CLAUDE.md`
- `claude-code-subagent-assignment.md`
- `.claude/flamenode/README.md`
- `.claude/flamenode/requirements-map.md`
- `.claude/flamenode/phases/00-repo-cartography.md`
- `.claude/flamenode/source/flamenode_final_detailed_design.md`
- `.claude/flamenode/source/flamenode_final_implementation_checklist.md`
- `.claude/flamenode/source/flamenode_final_consistency_audit.md`

`/flamenode-plan` では、**コード変更はさせない**。

期待する出力:

- 読んだファイル一覧
- 関連ファイル地図
- 4原典カバレッジ確認
- 推奨PR分割
- 最初のPR
- Opus判断が必要な箇所
- コード変更していないことの確認

---

## 11. `/flamenode-plan` が使えない場合の手入力プロンプト

Claude Code内でカスタムコマンドが見つからない場合は、次を貼る。

```text
コード変更はまだしないでください。
CLAUDE.md、claude-code-subagent-assignment.md、.claude/flamenode/README.md、.claude/flamenode/source/、.claude/flamenode/requirements-map.md を読んでください。
4つの原典の要求が抜け漏れなく反映されているか確認し、Phase 0として関連ファイル地図とPR分割案を出してください。

出力には必ず以下を含めてください。
1. 読んだファイル一覧
2. 関連ファイル地図
3. 4原典カバレッジ確認
4. 推奨PR分割
5. 最初のPR
6. Opus判断が必要な箇所
7. コード変更していないことの確認
```

---

## 12. 実装に入る前の確認コマンド

Claude Codeに作業させる前に、ターミナルで現在の状態を確認する。

```sh
git status
npm run typecheck
npm run build
```

最初からエラーが出る場合は、Claude Codeにこう伝える。

```text
実装前の時点で npm run typecheck / npm run build が失敗しています。
まずコード変更せず、失敗原因を要約してください。
修正が必要な場合は、修正案だけ出して、まだ変更しないでください。
```

---

## 13. 最初に着手するPR

最初の実装PRは、原則として次にする。

```sh
git checkout main
git pull origin main
git checkout -b auth/id-write-guard
```

Claude Codeに依頼する内容:

```text
.claude/flamenode/phases/01-id-auth-write-guard.md に従って、ID・権限・共通書き込みガードの実装計画を作ってください。
まだコード変更はしないでください。

出力には必ず以下を含めてください。
1. 対象フェーズ
2. 対応要求ID
3. 変更対象ファイル
4. 変更内容
5. サーバー側権限チェック
6. UI側変更
7. DB変更の有無
8. Opus判断が必要な箇所
9. テスト計画
```

計画を確認してから、実装させる。

```text
上の計画のうち、auth/id-write-guard PRに必要な最小差分だけ実装してください。
UIだけでなく、Server Action / Route Handler 側でも必ず拒否してください。
実装後、変更ファイル一覧、対応要求ID、実行したコマンド、テスト結果、残課題を出してください。
```

---

## 14. サブエージェントを使う目安

Claude Code内で `/agents` を開くと、利用可能なサブエージェントを管理できる。

今回のリポジトリには、以下のプロジェクト用サブエージェントを用意している。

```text
flamenode-repo-cartographer
flamenode-implementation-agent
flamenode-architecture-reviewer
```

使い分け:

| エージェント | モデル | 用途 |
|---|---|---|
| `flamenode-repo-cartographer` | Haiku | Phase 0の調査。コード変更禁止。 |
| `flamenode-implementation-agent` | Sonnet | 通常実装。実装計画を出してから変更。 |
| `flamenode-architecture-reviewer` | Opus | 権限、DB、連続枠、security、公開API、最終レビュー。 |

初心者は、まずClaude Codeにこう言う。

```text
flamenode-repo-cartographer を使って Phase 0 の調査だけ行ってください。コード変更はしないでください。
```

実装時:

```text
flamenode-implementation-agent を使って、Phase 1 の実装計画を出してください。まだコード変更はしないでください。
```

レビュー時:

```text
flamenode-architecture-reviewer を使って、現在の差分を4原典と requirements-map.md に照らしてレビューしてください。
```

---

## 15. Claude Codeが勝手に大きく変えそうな時の止め方

変更範囲が広がりそうなときは、すぐ止める。

```text
変更範囲が大きすぎます。
今回のPRでは auth/id-write-guard に関係する最小差分だけに絞ってください。
UI全面改修、DB整理、スロットロジック修正は別PRに分けてください。
```

仕様判断を含む場合:

```text
その変更は仕様判断を含みます。
実装せず、まず選択肢・メリット・リスク・推奨案を出してください。
Opus判断が必要なら、flamenode-architecture-reviewer に渡してください。
```

---

## 16. 差分確認

Claude Codeが変更した後、ターミナルで確認する。

```sh
git status
git diff --stat
git diff
```

ファイルごとに見たい場合:

```sh
git diff path/to/file.ts
```

変更が大きすぎる場合:

```sh
git restore path/to/file.ts
```

全部戻す場合は危険なので、よく確認してから実行する。

```sh
git restore .
```

---

## 17. テスト・ビルド

最低限:

```sh
npm run typecheck
npm run build
```

DB migrationを触った場合は、プロジェクトのREADMEやpackage.jsonにあるDBコマンドを確認して実行する。

```sh
cat package.json
```

よくある例:

```sh
npm run db:generate
npm run db:migrate
```

ただし、DBコマンドはプロジェクトの現行定義に従う。

---

## 18. 実装後は `/flamenode-review` を実行する

Claude Code内で次を入力する。

```text
/flamenode-review
```

このコマンドは、現在の差分を4原典、`requirements-map.md`、最終チェックリストに照らしてレビューするためのもの。

期待する出力:

- マージ可 / 要修正 / 追加調査
- 実行コマンド
- 4原典カバレッジ
- 要求IDカバレッジ
- ブロッカー
- 非ブロッカー
- 次PRへ回してよい項目
- 修正指示

`/flamenode-review` が使えない場合は、次を貼る。

```text
.claude/flamenode/phases/09-final-review.md に従って、現在の差分を4原典と requirements-map.md に照らしてレビューしてください。
必ず npm run typecheck と npm run build の結果も確認してください。
結論は、マージ可 / 要修正 / 追加調査 のいずれかで出してください。
```

---

## 19. PR本文テンプレート

PR本文には、要求IDカバレッジを必ず入れる。

```md
## 目的

## 変更内容

## 対応した要求ID
- 例: B-1, B-6, E-1, E-3, E-4

## 対応しない要求ID
- 今回のPR範囲外: ...

## Opus判断が必要な要求ID
- なし / あり: ...

## DB変更
- なし / あり

## 権限変更
- なし / あり

## UI変更
- なし / あり

## 破壊的変更
- なし / あり

## 4原典の反映確認
- [ ] flamenode_final_detailed_design.md
- [ ] flamenode_final_implementation_checklist.md
- [ ] flamenode_final_consistency_audit.md
- [ ] flamenode_revision_instructions_answered.md / requirements-map.md

## 確認したこと
- [ ] npm run typecheck
- [ ] npm run build
- [ ] 権限なしユーザーでAPI直叩きテスト
- [ ] X ID切替テスト
- [ ] 公開APIの漏洩チェック

## 残課題
```

---

## 20. コミット

変更確認:

```sh
git status
git diff --stat
```

ステージング:

```sh
git add .
```

コミット:

```sh
git commit -m "feat: add shared write guard"
```

ドキュメントだけなら:

```sh
git commit -m "docs: update Claude Code implementation guide"
```

---

## 21. push とPR作成

```sh
git push origin auth/id-write-guard
```

GitHub CLIがある場合:

```sh
gh pr create --base main --head auth/id-write-guard --title "feat: add shared write guard" --body-file pr-body.md
```

GitHub CLIがない場合は、GitHubの画面に表示される `Compare & pull request` からPRを作る。

---

## 22. よくあるトラブル

### `claude: command not found`

確認:

```sh
npm list -g --depth=0
npm bin -g
```

シェルを再読み込み:

```sh
source ~/.zshrc
```

または:

```sh
hash -r
```

再インストール:

```sh
npm install -g @anthropic-ai/claude-code
```

### npmの権限エラー

`sudo npm install -g` は避ける。

npmのglobal prefixをユーザー配下にする例:

```sh
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
npm install -g @anthropic-ai/claude-code
```

### `/flamenode-plan` が出てこない

まず、リポジトリのルートにいるか確認。

```sh
pwd
ls .claude/commands
```

`flamenode-plan.md` が見えるか確認。

```sh
cat .claude/commands/flamenode-plan.md
```

Claude Codeを再起動。

```text
/clear
```

または一度終了して再度起動。

```sh
claude
```

### サブエージェントが見つからない

Claude Code内で確認。

```text
/agents
```

ターミナル側でも確認。

```sh
ls .claude/agents
```

### `npm run build` が失敗する

Claude Codeにこう投げる。

```text
npm run build が失敗しました。
エラーログを読み、原因を分類してください。
修正はまだ行わず、最小修正案を出してください。
```

### 変更が多すぎて怖い

```sh
git diff --stat
```

Claude Codeにこう投げる。

```text
変更差分が大きすぎます。
今回のPR目的に必要な変更と、不要な変更を分類してください。
不要な変更は戻す手順を提案してください。
```

---

## 23. 初心者向けの安全な進め方

1. `git checkout -b docs/claude-code-plan`
2. `claude` を起動
3. `/flamenode-plan` を実行
4. `git diff` で変更がないことを確認
5. 実装PRは `auth/id-write-guard` から始める
6. 実装前に必ず計画だけ出させる
7. 1PRで1テーマだけ触る
8. 毎回 `npm run typecheck` と `npm run build`
9. 実装後に `/flamenode-review`
10. 不安な判断は `flamenode-architecture-reviewer` に上げる

---

## 24. 最低限これだけ覚える

```sh
# インストール
npm install -g @anthropic-ai/claude-code

# 状態確認
claude doctor

# リポジトリ取得
git clone https://github.com/coroke3/flamenode.git
cd flamenode

# 依存関係
npm install

# 最新化
git checkout main
git pull origin main

# 調査ブランチ
git checkout -b docs/claude-code-plan

# Claude Code起動
claude
```

Claude Code内:

```text
/flamenode-plan
```

実装に入るなら:

```sh
git checkout main
git pull origin main
git checkout -b auth/id-write-guard
claude
```

Claude Code内:

```text
.claude/flamenode/phases/01-id-auth-write-guard.md に従って、まず実装計画だけ出してください。まだコード変更はしないでください。
```

確認:

```sh
npm run typecheck
npm run build
git diff --stat
```

レビュー:

```text
/flamenode-review
```

コミット・push:

```sh
git add .
git commit -m "feat: add shared write guard"
git push origin auth/id-write-guard
```
