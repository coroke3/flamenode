import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path) =>
  readFile(new URL(`../../../${path}`, import.meta.url), "utf8");

test("投稿フォームは pending 反映前の二重送信を ref で拒否し、完了後に解放する", async () => {
  const [videoForm, membersForm, statusForm, approveActions, quickApprove] = await Promise.all([
    read("src/components/forms/VideoForm.tsx"),
    read("src/components/admin/AdminVideoMembersForm.tsx"),
    read("src/components/video/VideoStatusForm.tsx"),
    read("src/components/video/VideoApproveActions.tsx"),
    read("src/components/admin/VideoReviewQuickApproveButton.tsx"),
  ]);

  assert.match(videoForm, /submitInFlightRef\s*=\s*React\.useRef\(false\)/);
  assert.match(videoForm, /if \(pending \|\| submitInFlightRef\.current\) return/);
  assert.match(videoForm, /submitInFlightRef\.current\s*=\s*true/);
  assert.match(videoForm, /finally\s*\{[\s\S]*submitInFlightRef\.current\s*=\s*false/);
  assert.match(membersForm, /submitInFlightRef\s*=\s*React\.useRef\(false\)/);
  assert.match(membersForm, /if \(pending \|\| submitInFlightRef\.current\) return/);
  assert.match(membersForm, /submitInFlightRef\.current\s*=\s*true/);
  assert.match(membersForm, /finally\s*\{[\s\S]*submitInFlightRef\.current\s*=\s*false/);
  assert.match(membersForm, /redirectForGuardReason\(router, next\.reason, currentPath\)/);
  for (const source of [statusForm, approveActions, quickApprove]) {
    assert.match(source, /Ref\s*=\s*React\.useRef\(false\)/);
    assert.match(source, /Ref\.current\) return/);
    assert.match(source, /Ref\.current\s*=\s*true/);
    assert.match(source, /finally\s*\{[\s\S]*Ref\.current\s*=\s*false/);
  }
});

test("投稿フォームは予期しない action 例外を画面上のエラーへ変換する", async () => {
  const [videoForm, membersForm] = await Promise.all([
    read("src/components/forms/VideoForm.tsx"),
    read("src/components/admin/AdminVideoMembersForm.tsx"),
  ]);

  assert.match(videoForm, /catch \(error\)[\s\S]*setResult\(\{[\s\S]*ok:\s*false/);
  assert.match(membersForm, /catch \(error\)[\s\S]*setResult\(\{[\s\S]*ok:\s*false/);
  assert.match(membersForm, /role=\{result\.ok \? "status" : "alert"\}/);
});

test("一般カスタム質問は event/question key 付きの FormData 名で送信する", async () => {
  const source = await read("src/components/forms/VideoForm.tsx");
  assert.match(source, /custom_questions\?:\s*CustomQuestion\[\]/);
  assert.match(source, /custom_answer:\$\{event\.id\}:\$\{question\.question_key\}/);
  assert.match(source, /selectedCustomQuestions/);
  assert.match(source, /question\.required/);
});

test("編集画面は一般カスタム質問の既存回答を全件復元する", async () => {
  const source = await read("app/(auth)/dashboard/edit/[id]/page.tsx");
  assert.match(source, /fetchActiveCustomQuestionsForEvents/);
  assert.match(source, /custom_answers:\s*initialCustomAnswers/);
  assert.match(source, /D1_VIDEO_ANSWER_ID_CHUNK_SIZE = 80/);
  assert.match(source, /chunkIds\(\s*customQuestionIds/);
  assert.match(source, /\.limit\(questionIdChunk\.length\)/);
  assert.doesNotMatch(source, /customAnswerRows[\s\S]{0,900}\.limit\(5\)/);
});

test("submitter_change_denied の CTA は既存 query を URLSearchParams で保持する", async () => {
  const source = await read("src/components/ui/ErrorCallout.tsx");
  assert.match(source, /function withQueryParam/);
  assert.match(source, /params\.set\(key, value\)/);
  assert.match(source, /withQueryParam\(buildNext\(\), "privileged", "admin"\)/);
  assert.doesNotMatch(source, /\$\{buildNext\(\)\}\?privileged=admin/);
});

test("YouTube入力は生IDを送れるtext欄でサーバー検証へ委ねる", async () => {
  const source = await read("src/components/forms/VideoForm.tsx");
  const inputs = [...source.matchAll(/<input[\s\S]*?id=\"youtube_url\"[\s\S]*?\/>/g)];
  assert.equal(inputs.length, 2);
  for (const match of inputs) {
    assert.match(match[0], /type=\"text\"/);
    assert.match(match[0], /inputMode=\"url\"/);
  }
});
