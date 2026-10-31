# D-04 Active X 一斉切替チェックポイント（MIG-0605 U05e）

> 状態: **設計・停止条件のみ。未承認・未実施**  
> 決定: D-03（承認済みowner Xへの既存interaction fan-out） / D-04（単一feature flagによる一斉cutover）  
> 本書は本番切替の実行許可・実行証明ではない。実行責任者は別途指定する。

## 目的と正本

CURRENT の like / bookmark は `video_interactions_auth`（Auth User単位）、TARGET は `video_interactions`（Active X単位）。既存データのfan-outは、各Auth Userが **owner** として保有する **approved X** の全件が対象となる。managerのみ、pending、rejected、importedを含めない。切替後の新規操作は選択中Active Xのみに作用する。

根拠:
- [OPEN_DECISIONS.md](OPEN_DECISIONS.md) D-03 / D-04
- [ACTIVE_X_MIGRATION_PLAN.md](ACTIVE_X_MIGRATION_PLAN.md) §3・§3a・§4・§5・§6
- [ROUTING_AND_DEPLOY_PLAN.md](ROUTING_AND_DEPLOY_PLAN.md) §4・§5
- [PHASE_6_SPEC.md](PHASE_6_SPEC.md) MIG-0605 U05e
- [STATUS.md](STATUS.md) — mainへマージ済みの進捗だけが正本。open PRは作業済み扱いしない

## 切替を開始してはいけない条件（いずれか1つでSTOP）

- [ ] MIG-0658の **ローカル読取専用** D-03 dry-runを実施し、実ファイルの正当性・入力時点・スクリプト版・証跡を保存した。dry-run未実施、WALの不整合なコピー、結果未確定のまま続行しない。
- [ ] 旧interactionの全書き込み経路と、新Hono/Next/SPA/非同期consumerの全読み書き経路を、**コード・Route設定・実行環境**で特定した。未検出の旧経路からの書き込みがあればSTOP。
- [ ] flagの実際の `system_settings` キー名、デフォルト値、読取箇所、双方のアプリでの評価規則をコードとテストで確定した。**ここではフラグ名やコマンドを推定しない**。存在・一斉切替の原子性が不明ならSTOP。
- [ ] MIG-0702を含む必要なAPI/SPAのパリティ、Auth User ↔ Active X選択、未連携モーダル、CSRF/Origin/権限/可視性、同一cookieと旧URL互換を非本番E2Eで検証済み。
- [ ] 共有X、多名義、無owner、承認取り消し、merge/alias、like解除、bookmark解除、並列書き込み、再試行のケースで差分照合が成立した。
- [ ] X ID重複候補、既存Xレコードとの衝突、`videos.app_like_count` のdistinct再集計差分、および未割当Auth操作件数を**全件**照合した。上位50件などの省略出力だけでOKとしない。
- [ ] 切替後のX側操作をAuth側に機械的に戻せない場合に備え、時点・actor・type・追加/解除の監査付きdelta/逆同期と、表現不能な共有X衝突の隔離規則を非本番で実証した。
- [ ] 非本番で書き込み停止→最終差分照合→flag一斉切替→旧コードでの読み書き検証→**逆戻し演習**まで成功した。単なるflagの反転試験は不可。
- [ ] 依存するPRがmainへ統合済みで、最終HEADの必須CI、独立review、必要なPhase GateがすべてPASSしている。
- [ ] 本番D1への書き込み/バッチ移行、Worker Route、Custom Domain、secret、デプロイ、flag操作のそれぞれについて**実行直前のユーザー明示承認**を受けた。D-04がDECIDEDであることは承認の代わりにならない。

未達項目には担当者、証拠URL、再開条件を記入する。空欄を成功と解釈しない。

## 実行前の証跡台帳（すべて記入するまで停止）

| 項目 | 記録する事実 |
| --- | --- |
| Owner / Lead / Reviewer | GitHubで識別できる担当者と独立承認URL |
| 非本番dry-run | MIG-0658のcommit、コマンド、ローカルDB snapshot識別子、実行日時、結果（生の個人情報は公開しない） |
| 対象source / flag | 現行・新規の全読み書き経路、設定キーと既定値、旧/新の実環境とcommit SHA |
| チェックサム/件数 | Auth旧行数、X候補unique、ownerなし残行、X既存衝突、同時編集のdelta、like distinct集計 |
| write freeze | 停止対象エンドポイント/Queue/旧Action、停止方法、実際に書き込み0を確認した時間帯 |
| rollback | 非本番の逆同期/差分隔離、旧システムE2E、オンコール責任者と再開条件 |
| Approval | 本番操作ごとの承認URL・対象・時刻（包括承認は不可） |

## 承認済み実行者用の順序（本PRでは実行しない）

1. 変更対象の本番route、Worker、静的配信、Authセッション、D1/Queueの現行状態を**読取専用**で記録し、復旧の基準点を固定する。
2. すべてのinteraction書き込み経路（旧Server Action、Hono API、SPA、非同期経路を含む）を凍結する。凍結できない経路が一つでもあれば停止する。
3. D-03のowner-approved名義への最終fan-outと、初回dry-run後の**追加と解除の両方**を照合する。単純な`INSERT OR IGNORE`で削除済みlikeを復活させない。D1日次書込・1batchの予算を検証し、上限内の分割実行と監査を記録する。
4. `video_interactions` のキー単位unique、無owner行の旧側保持、X承認状態、全動画like件数、衝突隔離リストが基準点と一致したら、実装済みの**単一flag**で旧/新の読取・書込先を同時に切り替える。flagの詳細は実装確認まで未指定。
5. 旧URL・新SPA双方から承認済みXと未連携ユーザーのread/write/retry/undoをスモーク確認する。可視性・権限・監査・派生データ遅延も確認する。
6. 監視ウィンドウとrollback停止条件を運用者が宣言する。異常を検出したら追加書き込みを凍結し、下記の安全な復旧判定へ進む。

## ロールバック判定

**flagを旧値へ戻すだけのrollbackは禁止。** TARGET切替後のX単位の操作はAuth側の1行では表現できないことがある。

1. 全書き込みを再凍結し、切替後delta（like/bookmarkの追加・解除、X統合、名義/承認変更）を取得する。
2. Auth側に可逆な差分だけを監査付きで逆同期し、共有X・many-to-many・merge衝突は**隔離**し判断を求める。
3. 移行前と差分後の件数、各user状態、like集計、旧コードからの読取・書込をE2Eで再照合する。
4. すべてPASSの場合のみ、承認された旧経路へ切戻す。満たせない場合はX側をread-onlyとして維持し、承認されたforward-fix計画を選ぶ。
5. `video_interactions_auth` は安全な退役承認まで物理削除しない。

## 現在のチェックポイント（2026-10-31）

**未実施 / 切替不可**。本書はU05eの手順を明文化しただけであり、MIG-0605 U05x（SA-090/091）、U07とFinal auditは未完了。MIG-0658の出力を本書に実測として貼り付けていない。本番操作・権限変更・flag変更・Remote D1変更は0件。
