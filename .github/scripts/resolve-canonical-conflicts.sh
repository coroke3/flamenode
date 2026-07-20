#!/usr/bin/env bash
set -euo pipefail

REPO_BRANCH="agent/db-canonical-conflict-resolution-v8"
BASE_BRANCH="agent/db-canonical-migration-v2"
CANDIDATE_BRANCH="agent/db-canonical-final-integration"

mkdir -p .tmp
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git fetch --prune origin '+refs/heads/*:refs/remotes/origin/*'
git reset --hard "origin/${CANDIDATE_BRANCH}"
git merge -s ours --no-edit "origin/${BASE_BRANCH}"

take_or_delete() {
  local ref="$1"
  shift
  for path in "$@"; do
    if git cat-file -e "${ref}:${path}" 2>/dev/null; then
      git checkout "$ref" -- "$path"
    else
      git rm -rf --ignore-unmatch -- "$path"
      rm -rf -- "$path"
    fi
  done
}

# カスタム質問正本。旧stage_permissionとJSON二重保存を復活させない。
take_or_delete origin/agent/unify-custom-questions \
  app/'(auth)'/dashboard/edit/'[id]'/page.tsx \
  app/'(auth)'/entry/slotted/page.tsx \
  app/'(manage)'/manage/events/'[id]'/edit/page.tsx \
  src/components/admin/EventForm.tsx \
  src/components/admin/EventSettingsPreview.tsx \
  src/components/admin/VideoReviewDetailPanel.tsx \
  src/lib/actions/event-admin.ts \
  src/lib/actions/event-template-admin.ts \
  src/lib/admin/eventTemplateSettings.ts \
  src/lib/admin/videoReviewDetail.ts \
  src/lib/event/customQuestionForm.ts \
  src/lib/video/customQuestionAnswers.ts \
  src/lib/video/customQuestionLimits.ts \
  src/lib/video/customQuestions.ts \
  src/lib/video/submissionValidation.ts \
  src/lib/video/stagePermissionAnswers.ts \
  src/lib/video/stagePermissionQuestions.ts \
  src/lib/video/stagePermissionSubmission.ts \
  src/lib/video/formSettings.ts

# チャプター正本。video_chaptersだけを使用する。
take_or_delete origin/agent/chapter-comment-delete-and-validation \
  src/lib/actions/chapter.ts \
  src/lib/actions/video/submitSlotVideo.ts \
  src/lib/db/videoDetailQueries.ts \
  src/components/video/MemberSection.tsx \
  app/'(public)'/'[id]'/page.tsx

# 枠なし投稿は0件または1件のイベント所属とする。
take_or_delete origin/agent/unslotted-event-affiliation \
  app/'(auth)'/entry/unslotted/page.tsx \
  src/components/forms/UnslottedPostForm.tsx \
  src/lib/actions/video/createFreeVideo.ts \
  src/lib/event/unslottedPostPolicy.ts \
  src/lib/event/unslottedPostPolicy.test.mjs \
  src/lib/video/resolveUnslottedEventSyncTarget.ts

# 最新イベント公開ページ。
take_or_delete "origin/${BASE_BRANCH}" \
  app/'(public)'/event/'[id]'/page.tsx

# PR #100だけを旧形式インポート正本とする。
take_or_delete origin/agent/x-identity-import-hardening \
  app/'(admin)'/admin/import/page.tsx \
  app/api/admin/import/legacy/route.ts \
  src/components/admin/LegacyCanonicalImportClient.tsx \
  src/lib/import/legacy \
  src/lib/actions/xid-admin.ts \
  src/lib/actions/xid-merge-admin.ts \
  src/lib/auth/xIdentity.ts \
  src/lib/xid/merge.ts \
  scripts/check-db-legacy.mjs \
  scripts/check-docs.mjs

python <<'PY'
from pathlib import Path
import re


def read(name: str) -> tuple[Path, str]:
    path = Path(name)
    return path, path.read_text()


# max_slots_per_videoだけを作品単位の枠上限正本とする。
path, text = read('src/components/admin/EventForm.tsx')
text = re.sub(
    r'\n\s*<div>\s*<label className="fn-label">連続取得上限</label>[\s\S]*?name="max_consecutive_slots_per_entry"[\s\S]*?</div>',
    '',
    text,
    count=1,
)
text = text.replace('  max_consecutive_slots_per_entry?: number;\n', '')
if 'max_consecutive_slots_per_entry' in text:
    raise SystemExit('EventForm still contains max_consecutive_slots_per_entry')
path.write_text(text)

path, text = read('src/components/admin/EventSettingsPreview.tsx')
text = text.replace('  max_consecutive_slots_per_entry?: number | string | null;\n', '')
text = re.sub(r'\n\s*<Field label="連続取得上限"[^\n]*', '', text, count=1)
if 'max_consecutive_slots_per_entry' in text:
    raise SystemExit('EventSettingsPreview still contains max_consecutive_slots_per_entry')
path.write_text(text)

path, text = read('app/(manage)/manage/events/[id]/edit/page.tsx')
text = re.sub(
    r'\n\s*max_consecutive_slots_per_entry:\s*event\.max_consecutive_slots_per_entry,',
    '',
    text,
)
path.write_text(text)

# 認証ユーザーとX名義はx_user_account_linksで解決する。
for name in (
    'app/(auth)/dashboard/edit/[id]/page.tsx',
    'app/(auth)/entry/slotted/page.tsx',
):
    path, text = read(name)
    text = text.replace(
        '  xUsers as xUsersTable,\n',
        '  xUserAccountLinks as xUserAccountLinksTable,\n  xUsers as xUsersTable,\n',
    )
    text = re.sub(
        r'const xIdOptions = await db\s*\.select\(\{ id: xUsersTable\.id, x_name: xUsersTable\.x_name \}\)\s*\.from\(xUsersTable\)\s*\.where\(and\(\s*eq\(xUsersTable\.linked_user_id, user\.id\),\s*eq\(xUsersTable\.approval_status, "approved"\),\s*\)!\)\s*\.orderBy\(asc\(xUsersTable\.x_name\)\);',
        '''const xIdOptions = await db
    .select({ id: xUsersTable.id, x_name: xUsersTable.x_name })
    .from(xUserAccountLinksTable)
    .innerJoin(
      xUsersTable,
      eq(xUsersTable.id, xUserAccountLinksTable.x_user_id),
    )
    .where(and(
      eq(xUserAccountLinksTable.auth_user_id, user.id),
      eq(xUsersTable.approval_status, "approved"),
    )!)
    .orderBy(asc(xUsersTable.x_name));''',
        text,
        count=1,
    )
    if 'linked_user_id' in text:
        raise SystemExit(f'{name} still contains linked_user_id')
    path.write_text(text)

# 予約グループの型・関数を揃える。
path, text = read('app/(auth)/dashboard/page.tsx')
if 'type SlotBase,' not in text:
    text = text.replace(
        '  collapseReservationGroups,\n  sortSlotsChronologically,\n  type SlotGroupRow,\n',
        '  collapseReservationGroups,\n  sortSlotsChronologically,\n  type SlotBase,\n  type SlotGroupRow,\n',
    )
path.write_text(text)

# イベント作成時に作成者X名義のowner行を同一原子処理で生成する。
path, text = read('src/lib/actions/event-admin.ts')
text = text.replace(
    '  eventCustomQuestions,\n  eventTemplates,\n  events,',
    '  eventCustomQuestions,\n  eventStaff,\n  eventTemplates,\n  events,\n  xUserAccountLinks,\n  xUsers,',
)
duplicate = '''  const duplicate = (
    await db.select({ id: events.id }).from(events).where(eq(events.id, id)).limit(1)
  )[0];
  if (duplicate) return { ok: false, message: `ID「${id}」は既に存在します。` };
'''
if 'const ownerIdentity' not in text:
    owner_lookup = duplicate + '''
  const ownerIdentity = (
    await db
      .select({
        x_user_id: xUserAccountLinks.x_user_id,
        display_name: xUsers.x_name,
      })
      .from(xUserAccountLinks)
      .innerJoin(xUsers, eq(xUsers.id, xUserAccountLinks.x_user_id))
      .where(eq(xUserAccountLinks.auth_user_id, actorUserId))
      .limit(1)
  )[0];
  if (!ownerIdentity) {
    return {
      ok: false,
      message: "イベント作成には認証ユーザーへ紐付いた X 名義が必要です。",
    };
  }
'''
    if duplicate not in text:
        raise SystemExit('event duplicate anchor missing')
    text = text.replace(duplicate, owner_lookup, 1)
for obsolete in (
    '    max_consecutive_slots_per_entry: data.max_consecutive_slots_per_entry,\n',
    '    representative_x_user_id: null,\n',
    '    public_api_updated_at: null,\n',
):
    text = text.replace(obsolete, '')
row_anchor = '  } satisfies typeof events.$inferInsert;\n  const questions = buildQuestionRows(id, definitions, now);'
if 'const ownerRow' not in text:
    owner_row = '''  } satisfies typeof events.$inferInsert;
  const ownerRow = {
    id: generateId("es"),
    event_id: id,
    x_user_id: ownerIdentity.x_user_id,
    display_name: ownerIdentity.display_name,
    permission_preset: "owner" as const,
    custom_permission_keys_json: null,
    is_public: 1,
    public_role_label: "主催",
    approved_by_auth_user_id: actorUserId,
    approved_at: now,
    created_at: now,
    updated_at: now,
  } satisfies typeof eventStaff.$inferInsert;
  const questions = buildQuestionRows(id, definitions, now);'''
    if row_anchor not in text:
        raise SystemExit('event owner row anchor missing')
    text = text.replace(row_anchor, owner_row, 1)
text = text.replace(
    '    db.insert(events).values(createdRow),\n    ...insertChunks',
    '    db.insert(events).values(createdRow),\n    db.insert(eventStaff).values(ownerRow),\n    ...insertChunks',
    1,
)
text = text.replace(
    '    1,\n    ...insertChunks.map',
    '    1,\n    1,\n    ...insertChunks.map',
    1,
)
audit_anchor = '''    {
      table_name: "events",
      target_id: id,
      operation: "CREATE",
      before: null,
      after: createdRow,
      actor_user_id: actorUserId,
      retention_class: "normal",
      strict: true,
    },
'''
if 'context: "event-create:owner"' not in text:
    owner_audit = audit_anchor + '''    {
      table_name: "event_staff",
      target_id: ownerRow.id,
      operation: "CREATE",
      before: null,
      after: ownerRow,
      actor_user_id: actorUserId,
      context: "event-create:owner",
      reason: "イベント作成者をownerとして登録",
      retention_class: "long_audit",
      restore_strategy: "delete_created",
      strict: true,
    },
'''
    if audit_anchor not in text:
        raise SystemExit('event audit anchor missing')
    text = text.replace(audit_anchor, owner_audit, 1)
path.write_text(text)

# 旧chapters_json用引数をメンバー保存計画から除去する。
path, text = read('src/lib/actions/video/createFreeVideo.ts')
text = re.sub(r'\n\s*chaptersByIndex:\s*memberSubmission\.chaptersByIndex,', '', text)
path.write_text(text)

for relative in (
    '.agent-trigger/ci-fix',
    '.agent-trigger/current-ci',
    '.agent-trigger/final-merge-fix',
    '.github/workflows/export-merge-source-temporary.yml',
):
    Path(relative).unlink(missing_ok=True)
PY

if grep -RInE '^(<<<<<<<|=======|>>>>>>>)' -- . \
  --exclude-dir=.git --exclude-dir=node_modules --exclude='*.lock'; then
  exit 1
fi
git diff --check

npm ci --no-audit --no-fund
npm run typecheck 2>&1 | tee .tmp/typecheck.log
npm run lint
npm run test:unit
npm run test:workers
npm run test:cloudflare-ci
npm run test:integration
npm run build
npm run pages:build
npm run check:pages-output
npm run check:cloudflare-template
CLOUDFLARE_CONFIG_MODE=fixture npm run check:cloudflare-config
node scripts/create-owner-check-fixture.mjs
FLAMENODE_OWNER_CHECK_DB=.tmp/owner-check.sqlite npm run check:db-schema
npm run check:db-migration
npm run check:db-legacy
FLAMENODE_OWNER_CHECK_DB=.tmp/owner-check.sqlite npm run check:event-owners
npm run check:db-d1-empty
npm run check:db-d1-legacy
npm run check:ui-acceptance
npm run check:public-api-contract
npm run check:public-api-leaks
npm run check:project-docs
npm run check:docs
npm run check:db-history

rm -rf .agent-trigger .agent-patch .tmp
rm -f \
  .github/workflows/resolve-canonical-conflicts.yml \
  .github/scripts/resolve-canonical-conflicts.sh

git add -A
git diff --cached --check
git commit -m "全worktreeの有効差分をDB正本へ統合"
git push --force-with-lease origin HEAD:"${REPO_BRANCH}"
