import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  memberChaptersPayloadChanged,
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
const computeEditSectionsSource = await readFile(
  new URL("./computeEditSections.ts", import.meta.url),
  "utf8",
);

test("computeEditSections wires member_chapters section key", () => {
  assert.match(computeEditSectionsSource, /member_chapters:\s*boolean/);
  assert.match(computeEditSectionsSource, /section:\s*"member_chapters",\s*key:\s*"video\.member_chapters"/);
});

test("updateVideo rejects stage_permission changes in normal mode", () => {
  assert.match(updateVideoSource, /privilegeMode === "normal"/);
  assert.match(updateVideoSource, /changed\(nextStagePermission, currentStagePermission\)/);
  assert.match(updateVideoSource, /ステージ利用許可を編集する権限がありません。/);
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

test("updateVideo rejects member payload when members section disabled", () => {
  assert.match(updateVideoSource, /memberSubmissionPayloadChanged/);
  assert.match(updateVideoSource, /!sections\.members/);
});

test("VideoForm preserves is_collab when members section disabled", () => {
  assert.match(videoFormSource, /membersDisabled \?/);
  assert.match(videoFormSource, /value=\{initial\.is_collab \? "true" : "false"\}/);
  assert.doesNotMatch(
    videoFormSource,
    /membersDisabled[\s\S]{0,400}<input type="hidden" name="is_collab" value="false" \/>/,
  );
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
