# /flamenode-migration

FlameNodeの段階移行を **1回につき1タスクだけ** 進めるコマンド。
`/loop` と組み合わせても、必ず `docs/migration/STATUS.md` を正本にして進捗を継続する。

## 読む順序

1. `AGENTS.md`
2. `docs/AI_CONTEXT.md` の移行タスク行
3. `docs/migration/README.md`
4. `docs/migration/STATUS.md`
5. 対象に応じて `docs/migration/ROUTE_MATRIX.md` または `docs/migration/API_MATRIX.md`
6. 対象コードと関連test
7. 必要なActive文書を追加1件まで

Historical / archive / 完了済みphaseを一括で読まない。

## 実行契約

### 1. 現在地を決める

`STATUS.md` から以下を取得する。

- Current Phase
- Overall State
- Next Task
- task dependencies
- current Phase Gate

`Next Task` が `READY` でなければ、勝手に別taskを選ばない。
STATUSの不整合があれば実装より先にSTATUSを修復し、必要なら`BLOCKED`で停止する。

### 2. 1タスクだけclaimする

対象taskを `IN_PROGRESS` にする。

同時に、そのtaskについて以下を1〜2行で固定する。

```text
Task:
CURRENT:
TARGET:
Scope:
Non-scope:
Rollback:
Production action required: yes/no
```

### 3. 依存仕様を確認する

Route/UIなら `ROUTE_MATRIX.md`。
Server/APIなら `API_MATRIX.md`。
Cloudflareならrepo configと実Cloudflare設定を照合する。

推測でbinding、route、schema、permissionを作らない。

### 4. 実装する

原則:

- 1 PR = 1 migration boundary
- CURRENTのcontractを先にtestで固定
- framework-neutral layerを優先
- compatibility bridgeを明示
- legacy pathを同時に削除しない
- Big Bang rewrite禁止

### 5. 検査する

対象に必要な最小testを実行する。

基本候補:

```sh
npm run typecheck
npm run lint
npm run test:unit
npm run test:workers
npm run test:integration
npm run verify:fast
npm run check:docs
npm run check:project-docs
```

Public / API / Cloudflare taskでは、`docs/migration/README.md` のAcceptance Gateに対応する計測も行う。

### 6. STATUSを必ず更新する

iteration終了時、対象taskを次のいずれかへ遷移する。

- `DONE`
- `REVIEW`
- `BLOCKED`

`IN_PROGRESS` のまま終了しない。

`Last iteration` を更新する。

```text
Task:
Result:
Validation:
PR/commit:
Rollback:
Blockers:
```

次のtaskがdependenciesを満たしている場合のみ `READY` にする。

### 7. Phase Gate

Gate taskは自動で次Phaseを開始しない。

- Acceptance checklistを埋める
- `REVIEW` にする
- Lead確認を要求する

LeadがGateを承認した後だけ、次Phase最初のtaskを `READY` にする。

## `/loop` と併用する場合

推奨呼び出し:

```text
/loop /flamenode-migration
```

またはloop側に次の目的を指定する。

```text
FlameNode migrationを継続する。
各iterationで /flamenode-migration の契約に従い、STATUS.mdの次READY taskを1つだけ進める。
```

### Loop safety

1 iteration = 1 MIG task。

次の場合はloop継続条件を満たさないため停止する。

- Overall State = BLOCKED
- Next Task無し
- Phase GateがREVIEW
- production操作に明示承認が必要
- Remote D1 / secret / Worker Route / Custom Domain変更が必要
- auth/security/permission/visibilityで仕様衝突
- test failureの原因がtask scopeを超える
- rollback不能

### Loopで禁止

- taskをまとめて複数DONEにする
- Phase Gateを自動承認する
- production deployを自動実行する
- Worker Route / Custom Domainを自動変更する
- auth移行を前倒しする
- BLOCKED taskを無視して後続phaseへ進む
- STATUSを更新せず次iterationへ進む

## 完了報告フォーマット

```text
MIG-XXXX: <task>
State: DONE | REVIEW | BLOCKED

変更:
- ...

維持:
- ...

検査:
- ...

Rollback:
- ...

Next:
- MIG-YYYY | Phase Gate review | BLOCKED(reason)
```

説明を長文化しない。詳細進捗は `docs/migration/STATUS.md` を正本にする。
