# Claude Code 初心者向けターミナル実行ガイド

作成日: 2026-05-15
対象リポジトリ: `coroke3/flamenode`
関連正本: `claude-code-subagent-assignment.md`

このファイルは、Claude Codeを使ったことがない人が、ターミナルでFlameNode修正作業を始められるようにするための実行手順である。

---

## 0. 先に読むもの

作業前に、リポジトリ内の次のファイルを確認する。

```sh
cat claude-code-subagent-assignment.md
cat .claude/flamenode-subagent-routing.yaml
```

- `claude-code-subagent-assignment.md`: 実装仕様・作業順序・禁止事項の正本
- `.claude/flamenode-subagent-routing.yaml`: モデル割当・フェーズ・PR分割の機械参照用サマリ

仕様が衝突した場合は、`claude-code-subagent-assignment.md` を優先する。

---

## 1. 前提環境

Claude Codeの公式要件は以下。

- macOS 10.15以上、Ubuntu 20.04以上 / Debian 10以上、または Windows 10以上
- Windowsの場合はWSL、またはGit for Windowsを使用
- Node.js 18以上
- インターネット接続
- Bash / Zsh / Fish が推奨

Mac利用者は、通常は標準のターミナルまたはVS Codeのターミナルでよい。

---

## 2. Node.js と npm の確認

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

## 3. Claude Code のインストール

標準インストール:

```sh
npm install -g @anthropic-ai/claude-code
```

注意:

```sh
sudo npm install -g @anthropic-ai/claude-code
```

は使わない。権限トラブルの原因になる。

インストール確認:

```sh
claude --version
```

状態確認:

```sh
claude doctor
```

アップデート:

```sh
claude update
```

---

## 4. Claude Code にログインする

初回起動:

```sh
claude
```

ブラウザ認証を求められたら、表示されたURLまたは案内に従ってログインする。

ログイン後、ターミナルに戻ってClaude Codeが起動すればOK。

---

## 5. FlameNode リポジトリを取得する

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
git pull origin main
```

現在地確認:

```sh
pwd
ls
```

`package.json`、`README.md`、`claude-code-subagent-assignment.md` が見えればOK。

---

## 6. FlameNode の依存関係を入れる

```sh
npm install
```

`.dev.vars` が必要な場合:

```sh
cp .dev.vars.example .dev.vars
```

値が必要な環境変数は、実運用の秘密情報を勝手に作らず、管理者から受け取る。

---

## 7. 作業ブランチを作る

いきなり `main` で作業しない。

```sh
git checkout main
git pull origin main
git checkout -b docs/claude-code-test-run
```

実装PRの場合の例:

```sh
git checkout -b auth/id-write-guard
```

推奨PR分割は `claude-code-subagent-assignment.md` の `PR分割推奨` を参照する。

---

## 8. Claude Code をプロジェクトで起動する

リポジトリのルートで起動する。

```sh
claude
```

起動後、最初にClaude Codeへ貼るプロンプト:

```text
あなたは FlameNode のメイン実装エージェントです。

まずルート直下の claude-code-subagent-assignment.md を読み、作業をフェーズ分割してください。このファイルは自己完結版であり、外部の4つの修正指示ファイルがなくても実装可能な正本です。

必要に応じて .claude/flamenode-subagent-routing.yaml も参照してください。ただし仕様詳細が衝突した場合は claude-code-subagent-assignment.md を優先してください。

モデル運用:
- 基本は Sonnet。
- 本当に簡単な探索・文言・要約のみ Haiku。
- ID/権限/DB/連続枠/security/公開API漏洩/仕様衝突は Opus またはメインエージェント判断。

最初に行うこと:
1. README と設計ディレクトリと現行コードを確認する。
2. 本ファイルに対応する現行コードの所在を調査する。
3. Phase 0 のファイル地図を作る。
4. いきなり実装せず、PR分割案を出す。
5. 最初の実装PRは ID/権限/共通書き込みガードから始める。

禁止:
- Haikuに仕様判断をさせない。
- フロントだけで権限修正を済ませない。
- deprecated項目を新規利用しない。
- 連続枠を表示だけでごまかさない。
```

---

## 9. 最初にClaude Codeへやらせる安全な作業

初心者は、いきなり実装させず、まず調査だけにする。

Claude Codeに貼る:

```text
まずコード変更はしないでください。
claude-code-subagent-assignment.md の Phase 0 に従って、ID/権限、投稿、スロット、部番号、いいね/セーブ/ライブラリ、チャプターコメント、公開API、health/security に関係するファイルを探してください。

出力は以下の形式にしてください。
1. 領域名
2. 関連ファイル
3. そのファイルが担っていそうな責務
4. このファイルとのズレの可能性
5. Haikuで触ってよいか、Sonnet以上が必要か
```

これで、作業範囲の地図を作らせる。

---

## 10. 実装に入る前の確認コマンド

Claude Codeに作業させる前に、現在の状態を確認する。

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

## 11. 実装を依頼する例

### ID・権限・共通ガードから始める場合

```text
claude-code-subagent-assignment.md の Phase 1 に従って、ID・権限・共通書き込みガードの実装計画を作ってください。

まだコード変更はしないでください。
まず以下を出してください。
1. 変更対象ファイル
2. 追加するガード関数案
3. 投稿・編集・いいね・セーブ・ライブラリ・チャプターコメント・枠提出のどこに通すか
4. テスト方針
5. Opus判断が必要そうな箇所
```

計画を確認してから、実装させる。

```text
上の計画で、まず最小差分で実装してください。
ただし、UIだけでなくServer Action / Route Handler 側でも必ず拒否してください。
実装後、変更ファイル一覧とテスト結果を出してください。
```

---

## 12. Claude Codeが勝手に大きく変えそうな時の止め方

Claude Codeが大規模に触りそうなときは、こう言う。

```text
変更範囲が大きすぎます。
今回のPRでは auth/id-write-guard に関係する最小差分だけに絞ってください。
UI全面改修、DB整理、スロットロジック修正は別PRに分けてください。
```

または:

```text
その変更は仕様判断を含みます。
実装せず、まず選択肢・メリット・リスク・推奨案を出してください。
```

---

## 13. 差分確認

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

## 14. テスト・ビルド

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

## 15. コミット

変更確認:

```sh
git status
git diff --stat
```

ステージング:

```sh
git add claude-code-subagent-assignment.md .claude/flamenode-subagent-routing.yaml
```

通常の実装なら、変更したファイルを指定する。

```sh
git add app src workers migrations 設計
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

## 16. push とPR作成

```sh
git push origin auth/id-write-guard
```

GitHub CLIがある場合:

```sh
gh pr create --base main --head auth/id-write-guard --title "feat: add shared write guard" --body "See claude-code-subagent-assignment.md for implementation checklist."
```

GitHub CLIがない場合は、GitHubの画面に表示される `Compare & pull request` からPRを作る。

---

## 17. PR本文テンプレート

```md
## 目的

## 変更内容

## DB変更
- なし / あり

## 権限変更
- なし / あり

## UI変更
- なし / あり

## 破壊的変更
- なし / あり

## 確認したこと
- [ ] npm run typecheck
- [ ] npm run build
- [ ] 権限なしユーザーでAPI直叩きテスト
- [ ] X ID切替テスト
- [ ] 公開APIの漏洩チェック

## 残課題

```

---

## 18. よくあるトラブル

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

## 19. 初心者向けの安全な進め方

1. `git checkout -b docs/test-claude-code`
2. `claude` を起動
3. まず Phase 0 の調査だけをさせる
4. `git diff` で変更がないことを確認
5. 実装PRは `auth/id-write-guard` から始める
6. 1PRで1テーマだけ触る
7. 毎回 `npm run typecheck` と `npm run build`
8. 不安な判断は Opus に上げる

---

## 20. 最低限これだけ覚える

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

# 作業ブランチ
git checkout -b auth/id-write-guard

# Claude Code起動
claude

# 確認
npm run typecheck
npm run build
git diff --stat

# コミット・push
git add .
git commit -m "feat: add shared write guard"
git push origin auth/id-write-guard
```
