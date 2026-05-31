// Mock data for the FlameNode redesign prototype.
// Exports to window for use across JSX modules.

const CREATORS = [
  { id: "kotorinosu",    name: "ことりのす",          handle: "kotorinosu_mv", videos: 14 },
  { id: "tsukimi_track", name: "ツキミトラック",      handle: "tsukimi_track", videos: 9  },
  { id: "halo_loop",     name: "halo / loop",         handle: "halo_loop_v",   videos: 22 },
  { id: "negativecue",   name: "negative cue",        handle: "negativecue",   videos: 6  },
  { id: "rin_otsuka",    name: "凜・大塚",            handle: "rin_otsuka_",   videos: 31 },
  { id: "nuiton",        name: "ぬいとん",            handle: "nuiton_studio", videos: 4  },
  { id: "frame_index",   name: "frame index",         handle: "frame_index__", videos: 18 },
  { id: "yorukara",      name: "ヨルカラ",            handle: "yorukara_mv",   videos: 11 },
  { id: "ao_circuits",   name: "Ao Circuits",         handle: "ao_circuits",   videos: 7  },
  { id: "kosame",        name: "コサメ",              handle: "kosame_film",   videos: 16 },
  { id: "duotone_lab",   name: "Duotone Lab",         handle: "duotone_lab",   videos: 5  },
  { id: "minato_b",      name: "湊 / B-side",         handle: "minato_bside",  videos: 12 },
];

const VIDEOS = [
  { id: "fn-001", code: "PVSF2025S-014", title: "夜更けの導線",            creator: "halo_loop",     event: "pvsf2025s", music: "深淵 / silver leaf",    score: 9412, duration: "03:42", chapters: 7, posted: "2025-08-12" },
  { id: "fn-002", code: "PVSF2025S-009", title: "Pale Index",              creator: "rin_otsuka",    event: "pvsf2025s", music: "Quiet Frame / kage", score: 8821, duration: "02:51", chapters: 5, posted: "2025-08-09" },
  { id: "fn-003", code: "PVSF2025S-021", title: "結節線",                  creator: "frame_index",   event: "pvsf2025s", music: "Node / KAI",          score: 7766, duration: "04:18", chapters: 9, posted: "2025-08-15" },
  { id: "fn-004", code: "ARCHIVE-114",   title: "余白のための注釈",         creator: "kotorinosu",   event: "archive",   music: "Marginalia / suu",    score: 7044, duration: "03:12", chapters: 6, posted: "2025-07-30" },
  { id: "fn-005", code: "PVSF2025S-002", title: "Drift Section",           creator: "negativecue",   event: "pvsf2025s", music: "Drift / yuhki",       score: 6890, duration: "02:38", chapters: 4, posted: "2025-08-02" },
  { id: "fn-006", code: "NCNC2025-007",  title: "ちいさな観測",             creator: "tsukimi_track", event: "ncnc",      music: "観測点 / nine",       score: 6502, duration: "03:55", chapters: 8, posted: "2025-07-22" },
  { id: "fn-007", code: "PVSF2025S-018", title: "Quiet Volume",            creator: "yorukara",      event: "pvsf2025s", music: "Volume / aki",        score: 6231, duration: "03:01", chapters: 5, posted: "2025-08-14" },
  { id: "fn-008", code: "ARCHIVE-090",   title: "灰色の図解",               creator: "ao_circuits",   event: "archive",   music: "Plan / mizu",         score: 5980, duration: "04:42", chapters: 11, posted: "2025-07-18" },
  { id: "fn-009", code: "PVSF2025S-031", title: "FRAME / OBSERVER",        creator: "duotone_lab",   event: "pvsf2025s", music: "Observer / hex",      score: 5731, duration: "03:34", chapters: 6, posted: "2025-08-16" },
  { id: "fn-010", code: "ARCHIVE-066",   title: "脈動",                    creator: "kosame",        event: "archive",   music: "Pulse / suu",         score: 5402, duration: "02:48", chapters: 4, posted: "2025-07-04" },
  { id: "fn-011", code: "PVSF2025S-005", title: "Index, with care",        creator: "minato_b",      event: "pvsf2025s", music: "Care / nine",         score: 5187, duration: "03:26", chapters: 7, posted: "2025-08-05" },
  { id: "fn-012", code: "NCNC2025-011",  title: "節点と余白",              creator: "nuiton",        event: "ncnc",      music: "Whitespace / kai",    score: 4933, duration: "03:09", chapters: 5, posted: "2025-07-29" },
];

const EVENTS = [
  {
    id: "pvsf2025s",
    code: "PVSF2025S",
    title: "PVSF2025S",
    subtitle: "Personal Video Short Festival — 2025 Summer",
    summary: "個人制作映像作家のための短編フェスティバル。年2回開催の夏編。",
    accent: "#FFD400",
    rangeText: "8/29 — 8/31",
    submitOpenIso: "2025-08-29",
    submitCloseIso: "2025-08-31",
    entryOpenIso: "2025-07-12",
    entryCloseIso: "2025-08-15",
    todayIso: "2025-07-25",
    slotsTotal: 96,
    slotsAvailable: 22,
    entries: 74,
    creators: 51,
  },
  {
    id: "ncnc",
    code: "NCNC2025",
    title: "NCNC 2025",
    subtitle: "Node Cinema Night Collective",
    summary: "夜間オンライン上映会。会期は1夜、上映は連続再生。",
    accent: "#7BFF6B",
    rangeText: "10/04",
    submitOpenIso: "2025-10-04",
    submitCloseIso: "2025-10-04",
    entryOpenIso: "2025-09-01",
    entryCloseIso: "2025-09-28",
    todayIso: "2025-07-25",
    slotsTotal: 32,
    slotsAvailable: 32,
    entries: 0,
    creators: 0,
  },
  {
    id: "archive",
    code: "ARCHIVE",
    title: "FlameNode Archive",
    subtitle: "通年アーカイブ",
    summary: "過去作品の追加投稿。常時受付。",
    accent: "#FF9D54",
    rangeText: "常時",
    submitOpenIso: "2024-01-01",
    submitCloseIso: "2099-12-31",
    entryOpenIso: "2024-01-01",
    entryCloseIso: "2099-12-31",
    todayIso: "2025-07-25",
    slotsTotal: 0,
    slotsAvailable: 0,
    entries: 312,
    creators: 184,
  },
  {
    id: "pvsf2024w",
    code: "PVSF2024W",
    title: "PVSF2024W",
    subtitle: "Personal Video Short Festival — 2024 Winter",
    summary: "2024年冬編。全72枠が上映を終え、アーカイブ公開中。",
    accent: "#9FD4FF",
    rangeText: "2024 / 12",
    submitOpenIso: "2024-12-20",
    submitCloseIso: "2024-12-22",
    entryOpenIso: "2024-11-01",
    entryCloseIso: "2024-12-10",
    todayIso: "2025-07-25",
    slotsTotal: 72,
    slotsAvailable: 0,
    entries: 72,
    creators: 58,
  },
  {
    id: "ncnc2024",
    code: "NCNC2024",
    title: "NCNC 2024",
    subtitle: "Node Cinema Night Collective — 2024",
    summary: "夜間上映会の2024年版。1夜限りの連続上映、全38作品。",
    accent: "#FFA6B5",
    rangeText: "2024 / 10",
    submitOpenIso: "2024-10-05",
    submitCloseIso: "2024-10-05",
    entryOpenIso: "2024-09-01",
    entryCloseIso: "2024-09-26",
    todayIso: "2025-07-25",
    slotsTotal: 38,
    slotsAvailable: 0,
    entries: 38,
    creators: 31,
  },
];

// Slot table for event detail page — 6 days × 8 evening slots
const SLOT_HOURS = ["19:00", "19:30", "20:00", "20:30", "21:00", "21:30", "22:00", "22:30"];
const SLOT_DAYS = ["08/29 Fri", "08/30 Sat", "08/31 Sun"];

function buildSlotMatrix() {
  // Deterministic pseudo-random
  let s = 7;
  const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const matrix = [];
  for (let d = 0; d < SLOT_DAYS.length; d++) {
    const row = [];
    for (let h = 0; h < SLOT_HOURS.length; h++) {
      const r = rand();
      let status, name = null, videoCode = null;
      if (r < 0.55) {
        status = "reserved";
        const c = CREATORS[Math.floor(rand() * CREATORS.length)];
        name = c.name; videoCode = "PVSF2025S-" + String(Math.floor(rand()*40)+1).padStart(3,"0");
      } else if (r < 0.70) {
        status = "submitted";
        const c = CREATORS[Math.floor(rand() * CREATORS.length)];
        name = c.name; videoCode = "PVSF2025S-" + String(Math.floor(rand()*40)+1).padStart(3,"0");
      } else if (r < 0.78) {
        status = "reclaim";
      } else {
        status = "available";
      }
      row.push({ status, name, videoCode });
    }
    matrix.push(row);
  }
  return matrix;
}

const SLOT_MATRIX = buildSlotMatrix();

// Chapters for video detail
const CHAPTERS = [
  { time: 0,    label: "Open / 黒画面" },
  { time: 18,   label: "導入 — 結節" },
  { time: 47,   label: "Section A: drift" },
  { time: 84,   label: "中盤 — 音と余白" },
  { time: 122,  label: "Section B: pulse" },
  { time: 165,  label: "観測点" },
  { time: 198,  label: "Close" },
];

const COMMENTS = [
  { time: 18,  by: "tsukimi_track", body: "ここの白み出る瞬間良い" },
  { time: 47,  by: "rin_otsuka_",   body: "ドリフトのカット繋ぎ" },
  { time: 84,  by: "halo_loop_v",   body: "音とフレームの一致" },
  { time: 122, by: "frame_index__", body: "脈動のリズム" },
  { time: 165, by: "kosame_film",   body: "観測のための余白" },
];

Object.assign(window, {
  FN_CREATORS: CREATORS,
  FN_VIDEOS: VIDEOS,
  FN_EVENTS: EVENTS,
  FN_SLOT_HOURS: SLOT_HOURS,
  FN_SLOT_DAYS: SLOT_DAYS,
  FN_SLOT_MATRIX: SLOT_MATRIX,
  FN_CHAPTERS: CHAPTERS,
  FN_COMMENTS: COMMENTS,
});
