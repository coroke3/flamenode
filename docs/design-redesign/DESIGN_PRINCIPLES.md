# Design Principles

## 1. Action before decoration

画面を開いた直後に「現在の状態」「次の操作」「期限」が分かることを最優先する。見た目を新しくするためだけの要素は追加しない。

## 2. One primary action

1画面のprimary actionは原則1つ。secondary actionは1〜2個まで常時表示し、それ以外はtext action / menu / detailへ下げる。

## 3. Content is the public UI

Publicでは映像・サムネイル・タイトル・作者・イベントが主役。サイト自身の説明、巨大Hero、装飾背景は作品より前に出さない。

## 4. Dashboard answers “what now?”

Dashboardは分析画面ではない。順序は以下を基準とする。

1. Next Action
2. Deadline / warning
3. Active events
4. Submission state
5. My works
6. Notifications
7. Supporting stats

## 5. Manage is an event workspace

Manageはevent単位のworkspaceとして設計する。eventを選んだ後はページを行き来するよりTabsで同じ文脈を維持する。

## 6. Admin is a console

AdminはTable / List / Search / Filter / Status / Tabs / Drawer / Dialogを主役にする。大量データの比較・検索・誤操作防止を優先し、カードは例外扱いにする。

## 7. Fewer containers

階層はTypography / Spacing / Divider / Grid / Alignmentで作る。containerを追加する前にdividerだけで成立しないか確認する。

禁止に近い構造:

```text
Card
  Card
    Panel
      Card
```

## 8. Keep information, reduce presentation

機能や必要情報を消してシンプルに見せない。同じ情報をより密度の高い表・行・定義リストへ置き換える。

## 9. State must be explicit

statusは色だけに依存しない。text labelを必須にする。warning / dangerだけを強調し、normalは静かに表示する。

## 10. Mobile is a different arrangement

Desktopの縦積み化だけをresponsiveとしない。

- Sidebar → horizontal navigation / drawer
- Table → labeled row list
- Filters → full-width compact controls
- Tabs → horizontal scroll
- Form summary → formの後ろへ移動
- Video → viewport幅優先

## 11. FlameNode Sans is selective

FlameNode Sansをブランド・見出し・重要UIラベル・数値へ使う。長い本文や入力内容へはbody fontを使い、ブランドフォントの存在感と可読性を両立する。

## 12. Theme changes color, not structure

Light / Darkでlayout、情報密度、component hierarchyを変えない。同じ画面が同じ順序・サイズで機能すること。

## 13. Preserve behavior during mock phase

この提案段階では以下を変えない。

- API contract
- auth / permission
- DB writes
- owner invariant
- notification behavior
- slot behavior
- static/degraded public delivery
- Cloudflare deployment topology

UIの簡略化を理由に既存機能を削除しない。

## Decision order

迷ったら次の順で選ぶ。

1. 削る（重複表現を）
2. まとめる
3. 近づける
4. 並べ替える
5. 優先順位をつける
6. 必要な場合だけ追加する
