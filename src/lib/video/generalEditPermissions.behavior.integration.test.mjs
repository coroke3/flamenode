import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  memberChaptersPayloadChanged,
  memberListPayloadChanged,
  memberSubmissionPayloadChanged,
} from "./memberSubmissionCompare.ts";

const updateVideoSource = await readFile(
  new URL("../actions/video/updateVideo.ts", import.meta.url),
  "utf8",
);
const videoFormSource = await readFile(
  new URL("../../components/forms/VideoForm.tsx", import.meta.url),
  "utf8",
);
const editPageSource = await readFile(
  new URL("../../../app/(auth)/dashboard/edit/[id]/page.tsx", import.meta.url),
  "utf8",
);
const videoSavePlanSource = await readFile(
  new URL("./videoSavePlan.ts", import.meta.url),
  "utf8",
);
const chapterSource = await readFile(
  new URL("../actions/chapter.ts", import.meta.url),
  "utf8",
);
const computeEditSectionsSource = await readFile(
  new URL("./computeEditSections.ts", import.meta.url),
  "utf8",
);

test("computeEditSections wires member_chapters section key", () => {
  assert.match(computeEditSectionsSource, /member_chapters:\s*boolean/);
  assert.match(computeEditSectionsSource, /section:\s*"member_chapters",\s*key:\s*"video\.member_chapters"/);
});

test("edit page canEditAnySection includes member_chapters", () => {
  assert.match(editPageSource, /canEditMembers \|\|[\s\S]*canEditMemberChapters/);
  assert.match(editPageSource, /eventSections\.members \|\|[\s\S]*eventSections\.member_chapters/);
});

test("updateVideo rejects stage_permission changes in normal mode", () => {
  assert.match(updateVideoSource, /privilegeMode === "normal"/);
  assert.match(updateVideoSource, /changed\(nextStagePermission, currentStagePermission\)/);
  assert.match(updateVideoSource, /ステージ利用許可を編集する権限がありません。/);
});

test("updateVideo rejects profile_text change in normal mode", () => {
  assert.match(updateVideoSource, /changed\(parsed\.data\.profile_text, creatorXRow\.profile_text\)/);
  assert.match(updateVideoSource, /紹介文を編集する権限がありません。/);
});

test("updateVideo rejects music_reference_url without music general field", () => {
  assert.match(updateVideoSource, /changed\(parsed\.data\.music_reference_url, target\.music_reference_url\)/);
  assert.match(updateVideoSource, /!generalFields\.has\("music"\)/);
  assert.match(updateVideoSource, /楽曲参照URLを編集する権限がありません。/);
});

test("updateVideo rejects member chapters without chapters general field", () => {
  assert.match(updateVideoSource, /memberChaptersPayloadChanged/);
  assert.match(updateVideoSource, /!generalFields\.has\("chapters"\)/);
  assert.match(updateVideoSource, /メンバーチャプターを編集する権限がありません。/);
});

test("updateVideo rejects member list when members section disabled", () => {
  assert.match(updateVideoSource, /memberListPayloadChanged/);
  assert.match(updateVideoSource, /!sections\.members/);
});

test("updateVideo allows chapter-only save when member_chapters section enabled", () => {
  assert.match(updateVideoSource, /sections\.member_chapters/);
  assert.match(updateVideoSource, /existingMemberBaseline\.members/);
  assert.match(updateVideoSource, /submittedMemberBaseline\.chaptersByIndex/);
});

test("videoSavePlan persists members when member_chapters section enabled", () => {
  assert.match(videoSavePlanSource, /\(sections\.members \|\| sections\.member_chapters\) && plan\.memberSubmission/);
});

test("createChaptersBulk does not use normal member_chapters permission", () => {
  assert.doesNotMatch(chapterSource, /video\.member_chapters[\s\S]*privilegeMode:\s*"normal"/);
});

test("VideoForm preserves is_collab when members list disabled", () => {
  assert.match(videoFormSource, /membersListDisabled \?/);
  assert.match(videoFormSource, /value=\{isCollab \? "true" : "false"\}/);
  assert.doesNotMatch(
    videoFormSource,
    /membersListDisabled[\s\S]{0,400}<input type="hidden" name="is_collab" value="false" \/>/,
  );
});

test("VideoForm chapters editable independently of members list lock", () => {
  assert.match(videoFormSource, /const chaptersFieldDisabled = isFieldDisabled\(disabledFields, "chapters"\)/);
  assert.match(videoFormSource, /disabled=\{membersListDisabled\}/);
  assert.match(videoFormSource, /chaptersDisabled=\{chaptersFieldDisabled\}/);
});

test("memberListPayloadChanged detects member list edits only", () => {
  const baseline = {
    members: [
      {
        name: "A",
        x_user_id: "a",
        role: "",
        comment: "",
        chapters: [{ time: "0:12", label: "A", note: "" }],
      },
    ],
    chaptersByIndex: new Map([
      [
        0,
        [
          {
            time_seconds: 12,
            label: "A",
            note: "",
            order_index: 0,
          },
        ],
      ],
    ]),
  };
  const memberOnlyChange = {
    members: [
      {
        name: "B",
        x_user_id: "b",
        role: "",
        comment: "",
        chapters: [{ time: "0:12", label: "A", note: "" }],
      },
    ],
    chaptersByIndex: baseline.chaptersByIndex,
  };
  const chapterOnlyChange = {
    members: baseline.members,
    chaptersByIndex: new Map([
      [
        0,
        [
          {
            time_seconds: 65,
            label: "A",
            note: "",
            order_index: 0,
          },
        ],
      ],
    ]),
  };
  assert.equal(memberListPayloadChanged(baseline, memberOnlyChange), true);
  assert.equal(memberListPayloadChanged(baseline, chapterOnlyChange), false);
});

test("memberSubmissionPayloadChanged detects member list edits", () => {
  const baseline = {
    members: [
      {
        name: "A",
        x_user_id: "a",
        role: "",
        comment: "",
        chapters: [],
      },
    ],
    chaptersByIndex: new Map(),
  };
  const unchanged = {
    members: [
      {
        name: "A",
        x_user_id: "a",
        role: "",
        comment: "",
        chapters: [],
      },
    ],
    chaptersByIndex: new Map(),
  };
  const changed = {
    members: [
      {
        name: "B",
        x_user_id: "b",
        role: "",
        comment: "",
        chapters: [],
      },
    ],
    chaptersByIndex: new Map(),
  };
  assert.equal(memberSubmissionPayloadChanged(baseline, unchanged), false);
  assert.equal(memberSubmissionPayloadChanged(baseline, changed), true);
});

test("memberChaptersPayloadChanged detects chapter-only edits", () => {
  const baseline = {
    members: [
      {
        name: "A",
        x_user_id: "a",
        role: "",
        comment: "",
        chapters: [{ time: "0:12", label: "A", note: "" }],
      },
    ],
    chaptersByIndex: new Map([
      [
        0,
        [
          {
            time_seconds: 12,
            label: "A",
            note: "",
            order_index: 0,
          },
        ],
      ],
    ]),
  };
  const memberOnlyChange = {
    members: [
      {
        name: "A",
        x_user_id: "a",
        role: "作画",
        comment: "",
        chapters: [{ time: "0:12", label: "A", note: "" }],
      },
    ],
    chaptersByIndex: baseline.chaptersByIndex,
  };
  const chapterChange = {
    members: [
      {
        name: "A",
        x_user_id: "a",
        role: "",
        comment: "",
        chapters: [{ time: "1:05", label: "A", note: "" }],
      },
    ],
    chaptersByIndex: new Map([
      [
        0,
        [
          {
            time_seconds: 65,
            label: "A",
            note: "",
            order_index: 0,
          },
        ],
      ],
    ]),
  };
  assert.equal(memberChaptersPayloadChanged(baseline, memberOnlyChange), false);
  assert.equal(memberSubmissionPayloadChanged(baseline, memberOnlyChange), true);
  assert.equal(memberChaptersPayloadChanged(baseline, chapterChange), true);
});
