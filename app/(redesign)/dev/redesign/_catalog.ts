export type MockCategory =
  | "Public"
  | "Personal"
  | "Entry"
  | "Manage"
  | "Admin"
  | "System";

export type MockKind =
  | "public-home"
  | "public-list"
  | "public-detail"
  | "public-event"
  | "public-profile"
  | "public-info"
  | "dashboard"
  | "personal-list"
  | "personal-form"
  | "entry"
  | "entry-form"
  | "manage-dashboard"
  | "manage-event"
  | "manage-list"
  | "manage-form"
  | "manage-detail"
  | "admin-dashboard"
  | "admin-table"
  | "admin-form"
  | "admin-detail"
  | "system";

type SourceGroup = "public" | "auth" | "auth-complete" | "manage" | "admin";

export type MockRoute = {
  id: string;
  group: SourceGroup;
  category: MockCategory;
  kind: MockKind;
  url: string;
  source: string;
  title: string;
  user: string;
  purpose: string;
  primaryAction: string;
};

const makeId = (category: MockCategory, url: string): string => {
  const slug = url === "/"
    ? "home"
    : url
        .replace(/^\//, "")
        .replace(/\[|\]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "root";
  return `${category.toLowerCase()}-${slug}`;
};

const route = (
  group: SourceGroup,
  category: MockCategory,
  kind: MockKind,
  url: string,
  title: string,
  user: string,
  purpose: string,
  primaryAction: string,
): MockRoute => ({
  id: makeId(category, url),
  group,
  category,
  kind,
  url,
  source: `app/(${group})${url === "/" ? "" : url}/page.tsx`,
  title,
  user,
  purpose,
  primaryAction,
});

export const MOCK_CATEGORIES: readonly MockCategory[] = [
  "Public",
  "Personal",
  "Entry",
  "Manage",
  "Admin",
  "System",
];

export const MOCK_ROUTES: readonly MockRoute[] = [
  route("public", "Public", "public-home", "/", "ホーム", "閲覧者", "作品と開催中イベントをすぐ見つける", "作品を見る"),
  route("public", "Public", "public-detail", "/[id]", "作品詳細", "閲覧者", "映像を視聴し作品情報を確認する", "映像を再生"),
  route("public", "Public", "public-info", "/about", "FlameNodeについて", "閲覧者", "サービスの役割と使い方を理解する", "作品を見る"),
  route("public", "System", "system", "/dev/ui-surfaces", "UI surfaces", "開発者", "既存UIサーフェスを確認する", "サーフェスを確認"),
  route("public", "Public", "public-list", "/event", "イベント一覧", "閲覧者・参加者", "イベントを状態や時期から探す", "イベントを見る"),
  route("public", "Public", "public-event", "/event/[id]", "イベント詳細", "閲覧者・参加者", "イベント概要と作品を確認する", "作品を見る"),
  route("public", "Public", "public-event", "/event/[id]/release", "イベント公開ビュー", "閲覧者", "公開順でイベント作品を楽しむ", "連続再生"),
  route("public", "Public", "public-list", "/event/[id]/slots", "公開枠一覧", "参加者・閲覧者", "イベント枠の状況を確認する", "空き枠を確認"),
  route("public", "Public", "public-list", "/groups", "イベントグループ", "閲覧者", "関連イベント群を探す", "グループを見る"),
  route("public", "Public", "public-event", "/groups/[slug]", "イベントグループ詳細", "閲覧者", "シリーズ内のイベントと作品を追う", "イベントを見る"),
  route("public", "Public", "public-list", "/list", "作品一覧", "閲覧者", "条件を絞って作品を探す", "作品を開く"),
  route("public", "System", "system", "/maintenance", "メンテナンス", "全ユーザー", "利用できない理由と次の行動を理解する", "再確認"),
  route("public", "Public", "public-list", "/recommend", "おすすめ", "閲覧者", "選ばれた作品から次に見る作品を見つける", "作品を開く"),
  route("public", "Public", "public-info", "/rules", "利用規約・ルール", "全ユーザー", "利用条件を確認する", "必要な項目を確認"),
  route("public", "Public", "public-list", "/trending", "トレンド", "閲覧者", "最近注目されている作品を探す", "作品を開く"),
  route("public", "Public", "public-list", "/user", "クリエイター一覧", "閲覧者", "クリエイターを探す", "プロフィールを見る"),
  route("public", "Public", "public-profile", "/user/[id]", "クリエイター詳細", "閲覧者", "作者情報と作品をまとめて見る", "作品を見る"),
  route("public", "Public", "public-profile", "/user/[id]/portfolio", "ポートフォリオ", "閲覧者", "作者の作品を作品中心で閲覧する", "作品を見る"),

  route("auth", "Personal", "dashboard", "/dashboard", "ダッシュボード", "ログインユーザー", "今必要な提出・参加・作品管理を判断する", "必要な作業を続ける"),
  route("auth", "Personal", "personal-form", "/dashboard/edit/[id]", "作品編集", "作品所有者・共同編集者", "作品情報と公開状態を更新する", "変更を保存"),
  route("auth", "Personal", "personal-form", "/dashboard/edit/[id]/permissions", "作品権限", "作品所有者", "共同編集者と権限を管理する", "権限を更新"),
  route("auth", "Personal", "personal-list", "/dashboard/library", "ライブラリ", "ログインユーザー", "保存・関連作品を再確認する", "作品を開く"),
  route("auth", "Personal", "personal-form", "/dashboard/settings", "アカウント設定", "ログインユーザー", "活動名義とアカウント設定を管理する", "設定を保存"),
  route("auth", "Personal", "personal-list", "/dashboard/youtube-playlists", "YouTubeプレイリスト", "ログインユーザー", "自分に関連するプレイリストを確認する", "プレイリストを見る"),
  route("auth", "Entry", "entry", "/entry", "参加・投稿", "参加者・投稿者", "次に必要な参加・提出・通常投稿を選ぶ", "期限が近い作業を続ける"),
  route("auth", "Entry", "entry-form", "/entry/slotted", "枠への作品提出", "枠確保済み参加者", "確保済み枠に作品を紐付けて提出する", "作品を提出"),
  route("auth", "Entry", "entry-form", "/entry/unslotted", "通常投稿", "投稿者", "イベント枠に依存しない作品を登録する", "作品を投稿"),
  route("auth", "System", "system", "/onboarding", "初期設定", "新規ユーザー", "規約同意と活動名義の準備を完了する", "初期設定を完了"),
  route("auth-complete", "System", "system", "/auth/complete", "認証完了", "認証中ユーザー", "認証結果を確認して元の作業へ戻る", "続行"),

  route("manage", "Manage", "manage-dashboard", "/manage", "イベント運営", "イベント運営者", "担当イベントの問題と次の作業を把握する", "要対応イベントを開く"),
  route("manage", "Manage", "manage-event", "/manage/events/[id]", "イベント運営詳細", "イベント運営者", "イベント状態と運営タスクを一画面で判断する", "要対応タブを開く"),
  route("manage", "Manage", "manage-list", "/manage/events/[id]/audience", "Audience", "イベント運営者", "視聴者関連情報を確認する", "対象を確認"),
  route("manage", "Manage", "manage-form", "/manage/events/[id]/edit", "イベント設定", "権限を持つ運営者", "イベント基本情報と公開設定を更新する", "設定を保存"),
  route("manage", "Manage", "manage-list", "/manage/events/[id]/review", "審査", "審査担当者", "審査待ち作品を順に処理する", "次の作品を審査"),
  route("manage", "Manage", "manage-list", "/manage/events/[id]/slots", "枠管理", "イベント運営者", "枠の空き・予約・提出状態を管理する", "問題のある枠を開く"),
  route("manage", "Manage", "manage-list", "/manage/events/[id]/staff", "スタッフ", "代表者・運営者", "スタッフ役割と権限を管理する", "スタッフを管理"),
  route("manage", "Manage", "manage-list", "/manage/events/[id]/videos", "投稿作品", "イベント運営者", "イベント作品を状態別に管理する", "要対応作品を開く"),
  route("manage", "Manage", "manage-detail", "/manage/events/[id]/videos/[videoId]", "作品運営詳細", "イベント運営者", "1作品の状態・審査・関連情報を確認する", "処理を確定"),
  route("manage", "Manage", "manage-list", "/manage/events/[id]/youtube-playlist", "YouTubeプレイリスト管理", "イベント運営者", "イベント用プレイリスト同期を確認する", "同期状態を確認"),
  route("manage", "Manage", "manage-list", "/manage/notifications", "運営通知センター", "イベント運営者", "失敗・保留中の通知を処理する", "失敗通知を確認"),
  route("manage", "Manage", "manage-list", "/manage/x-link-requests", "X ID連携申請", "権限を持つ運営者", "X ID連携申請を確認・処理する", "申請を処理"),

  route("admin", "Admin", "admin-dashboard", "/admin", "管理ダッシュボード", "管理者", "全体の対応待ちと障害兆候を確認する", "最優先キューを開く"),
  route("admin", "Admin", "admin-table", "/admin/announcements", "お知らせ管理", "管理者", "お知らせを検索・公開管理する", "お知らせを作成"),
  route("admin", "Admin", "admin-form", "/admin/announcements/[id]/edit", "お知らせ編集", "管理者", "既存のお知らせを更新する", "変更を保存"),
  route("admin", "Admin", "admin-form", "/admin/announcements/new", "お知らせ作成", "管理者", "新しいお知らせを作成する", "公開設定へ進む"),
  route("admin", "Admin", "admin-table", "/admin/api-endpoints", "公開API管理", "管理者", "公開APIの状態と露出範囲を確認する", "エンドポイントを確認"),
  route("admin", "Admin", "admin-table", "/admin/audit", "監査ログ", "管理者", "操作履歴を条件検索する", "ログを絞り込む"),
  route("admin", "Admin", "admin-detail", "/admin/audit/[id]", "監査ログ詳細", "管理者", "1件の変更内容と主体を確認する", "関連対象を確認"),
  route("admin", "Admin", "admin-form", "/admin/audit/restore", "監査復元", "管理者", "復元対象と影響を確認して実行する", "復元内容を確認"),
  route("admin", "Admin", "admin-form", "/admin/audit/settings", "監査設定", "管理者", "監査ログの運用設定を管理する", "設定を保存"),
  route("admin", "Admin", "admin-detail", "/admin/cost-guard", "コストガード", "管理者", "operation modeと保護状態を確認する", "モードを確認"),
  route("admin", "Admin", "admin-table", "/admin/event-groups", "イベントグループ管理", "管理者", "イベントグループを一覧管理する", "グループを作成"),
  route("admin", "Admin", "admin-form", "/admin/event-groups/[id]/edit", "イベントグループ編集", "管理者", "イベントグループを更新する", "変更を保存"),
  route("admin", "Admin", "admin-form", "/admin/event-groups/new", "イベントグループ作成", "管理者", "イベントグループを作成する", "作成"),
  route("admin", "Admin", "admin-table", "/admin/events", "イベント管理", "管理者", "全イベントを状態・時期で管理する", "イベントを開く"),
  route("admin", "Admin", "admin-detail", "/admin/events/[id]", "イベント管理詳細", "管理者", "イベント全体の設定と状態を確認する", "運営画面を開く"),
  route("admin", "Admin", "admin-form", "/admin/events/[id]/edit", "イベント編集", "管理者", "イベント設定を更新する", "変更を保存"),
  route("admin", "Admin", "admin-table", "/admin/events/[id]/slots", "管理者向け枠管理", "管理者", "イベント枠を管理する", "枠を確認"),
  route("admin", "Admin", "admin-table", "/admin/events/[id]/staff", "管理者向けスタッフ管理", "管理者", "イベントスタッフを管理する", "スタッフを確認"),
  route("admin", "Admin", "admin-form", "/admin/events/new", "イベント作成", "管理者", "新規イベントを作成する", "イベントを作成"),
  route("admin", "Admin", "admin-table", "/admin/events/templates", "イベントテンプレート", "管理者", "イベント作成テンプレートを管理する", "テンプレートを選択"),
  route("admin", "Admin", "admin-detail", "/admin/health", "ヘルスチェック", "管理者", "サービス状態を短時間で診断する", "異常項目を確認"),
  route("admin", "Admin", "admin-detail", "/admin/health/integrity", "データ整合性", "管理者", "DB整合性チェック結果を確認する", "異常を確認"),
  route("admin", "Admin", "admin-table", "/admin/history", "履歴", "管理者", "管理対象の履歴を確認する", "履歴を絞り込む"),
  route("admin", "Admin", "admin-form", "/admin/import", "旧形式インポート", "管理者", "旧データを検証して取り込む", "検証を実行"),
  route("admin", "Admin", "admin-table", "/admin/moderation", "モデレーション", "管理者", "未解決ケースを優先度順に処理する", "最優先ケースを開く"),
  route("admin", "Admin", "admin-table", "/admin/notifications", "通知配信", "管理者", "通知キューと失敗を検索・再処理する", "失敗通知を確認"),
  route("admin", "Admin", "admin-form", "/admin/permissions/simulator", "権限シミュレーター", "管理者", "条件に対する権限結果を検証する", "権限を検証"),
  route("admin", "Admin", "admin-table", "/admin/rules", "規約管理", "管理者", "規約文書と状態を管理する", "規約を開く"),
  route("admin", "Admin", "admin-form", "/admin/rules/[id]/edit", "規約編集", "管理者", "規約本文と公開設定を更新する", "変更を保存"),
  route("admin", "Admin", "admin-form", "/admin/rules/new", "規約作成", "管理者", "新規規約を作成する", "規約を作成"),
  route("admin", "Admin", "admin-detail", "/admin/security", "セキュリティ", "管理者", "セキュリティ関連状態と注意点を確認する", "異常を確認"),
  route("admin", "Admin", "admin-table", "/admin/spreadsheet", "DBスプレッドシート", "管理者", "許可されたDB情報を表形式で確認する", "データを検索"),
  route("admin", "Admin", "admin-table", "/admin/static-builds", "静的JSON再生成", "管理者", "静的生成ジョブの状態と失敗を管理する", "失敗ジョブを確認"),
  route("admin", "Admin", "admin-table", "/admin/users", "ユーザー管理", "管理者", "ユーザーとX IDを検索・管理する", "ユーザーを検索"),
  route("admin", "Admin", "admin-detail", "/admin/users/[id]", "ユーザー詳細", "管理者", "1ユーザーの名義・権限・履歴を確認する", "必要な管理操作を選ぶ"),
  route("admin", "Admin", "admin-form", "/admin/users/[id]/edit", "ユーザー編集", "管理者", "ユーザー管理情報を更新する", "変更を保存"),
  route("admin", "Admin", "admin-table", "/admin/videos", "作品管理", "管理者", "作品を状態・作者・イベントで検索する", "要対応作品を開く"),
  route("admin", "Admin", "admin-detail", "/admin/videos/[id]", "作品管理詳細", "管理者", "作品の状態・関連情報を確認する", "状態を確認"),
  route("admin", "Admin", "admin-table", "/admin/videos/[id]/members", "作品メンバー", "管理者", "作品メンバーと権限を確認する", "メンバーを確認"),
  route("admin", "Admin", "admin-table", "/admin/workers", "Worker監視", "管理者", "Worker関連の状態と失敗を確認する", "異常Workerを確認"),
  route("admin", "Admin", "admin-table", "/admin/x-id-merges", "X ID統合", "管理者", "統合・取り消し申請を安全に処理する", "申請を開く"),
  route("admin", "Admin", "admin-table", "/admin/x-link-requests", "X ID連携申請", "管理者", "X ID連携申請を処理する", "申請を開く"),
  route("admin", "Admin", "admin-detail", "/admin/youtube-quota", "YouTube quota", "管理者", "quota消費状況を確認する", "使用状況を確認"),
  route("admin", "Admin", "admin-table", "/admin/youtube-sync", "YouTube同期", "管理者", "同期ジョブと失敗を管理する", "失敗同期を確認"),
  route("admin", "Admin", "admin-table", "/admin/youtube-sync/playlists", "YouTubeプレイリスト同期", "管理者", "プレイリスト同期状態を管理する", "同期状態を確認"),
];

export const MOCK_ROUTE_BY_ID = new Map(MOCK_ROUTES.map((item) => [item.id, item]));

export function mockHref(item: MockRoute): string {
  return `/dev/redesign/mock/${encodeURIComponent(item.id)}`;
}
