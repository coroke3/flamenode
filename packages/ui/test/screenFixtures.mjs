// Fixtures for the MIG-0205 representative screens. Values follow the registered mock
// (docs/migration/mock/static/{VideoDetail,EventDetail,Creator}.html); `img()` lets the
// screenshot harness point at the mock's own images.
export function videoFixture(img = (n) => `https://img.example/${n}`) {
  return {
    id: "v1",
    title: "空白合作",
    creator: {
      name: "空白合作チーム",
      xUserId: "vIXyOepPI395671",
      iconUrl: img("fc027fe6fe3a001a22a1933270ce72b9.jpg"),
      profileHref: "/user/vIXyOepPI395671",
      youtubeChannelUrl: "https://www.youtube.com/@kuuhaku",
    },
    publishedLabel: "2026.03.29",
    thumbnailUrl: img("3d8d62bbac75243d266ec6e3de039e6d.jpg"),
    hasYoutube: true,
    music: "ホワイトスペースにおいで",
    credit: "椎野乃々",
    musicReferenceUrl: "https://example.com/music",
    introComment: "勇気を出してみんなを誘いました",
    softwareLabel: "AviUtl, After Effects",
    highlights: "13人それぞれのパートが、1曲の中で順番に入れ替わります。",
    productionStory: "声をかけてから約1か月で全員のパートがそろいました。",
    closingComment: "見てくださった皆さん、ありがとうございました。",
    primaryEvent: {
      id: "pvsf2026sp",
      title: "PVSF2026Sp",
      iconUrl: img("6ecfc7b6882f277d815f563e873f25ee.jpg"),
      statusLabel: "開催済み",
      statusTone: "draft",
      accepting: false,
      playlistUrl: "https://www.youtube.com/playlist?list=PL123",
    },
    otherEvents: [{ id: "pvsf-digest", title: "PVSF まとめ動画" }],
    members: [
      { id: "m1", name: "丸い人", xUserId: "Maruihito_maru", iconUrl: img("fc027fe6fe3a001a22a1933270ce72b9.jpg"), role: "映像", comment: "イントロ担当", profileHref: "/user/Maruihito_maru", chapterTimes: ["0:00"] },
      { id: "m2", name: "ぴーふら", xUserId: "Fura1107_", iconUrl: img("525c7209e503b8327cbd5bf4a64e5fc8.jpg"), role: "映像", profileHref: null, chapterTimes: ["0:24"] },
      { id: "m3", name: "sum1", xUserId: "sum1_eizou", iconUrl: img("f5c1a8af077b887c7bb1d043f3cf69c1.jpg"), role: "映像", comment: "初合作でした", profileHref: "/user/sum1_eizou", chapterTimes: ["0:48"] },
      { id: "m4", name: "Eipi", xUserId: "Eipi_Rainbow", iconUrl: img("6ecfc7b6882f277d815f563e873f25ee.jpg"), role: "映像", chapterTimes: ["1:12"] },
    ],
    chapters: [
      { id: "c1", timeLabel: "0:00", label: "イントロ", authorName: "丸い人", kind: "member" },
      { id: "c2", timeLabel: "0:24", label: "ぴーふらパート", authorName: "ぴーふら", kind: "member" },
      { id: "c3", timeLabel: "0:48", label: "sum1パート", authorName: "sum1", kind: "member" },
      { id: "c4", timeLabel: "1:05", label: "ここの切り替え好き", authorName: "幼虫", kind: "comment" },
    ],
    related: [
      { href: "/r1", title: "個々々々々々人 / Sohbana", creatorName: "あいこーすふぃあ", thumbnailUrl: img("f5c1a8af077b887c7bb1d043f3cf69c1.jpg") },
      { href: "/r2", title: "魔法少女 このは・グリモワール 最終決戦編", creatorName: "おたこ", thumbnailUrl: img("be71b2f744d470e10fb8c8ca733bbace.jpg") },
      { href: "/r3", title: "Mitchie Mメドレー合作", creatorName: "Mitchie Mメドレー合作", thumbnailUrl: img("755d245a064a6f5935c3dccd9a941048.jpg") },
    ],
    likeCount: 128,
  };
}

export function eventFixture(img = (n) => `https://img.example/${n}`) {
  return {
    id: "pvsf2026s",
    title: "PVSF2026S",
    imageUrl: img("be71b2f744d470e10fb8c8ca733bbace.jpg"),
    iconUrl: img("6ecfc7b6882f277d815f563e873f25ee.jpg"),
    explanation: "個人制作の映像作品を2日間にわたって連続上映するイベントです。1枠5分、時間枠を確保して作品を提出してください。",
    statusLabel: "募集期間中",
    statusTone: "public",
    periodLabel: "2026.11.03 – 11.04",
    entryAction: "reserve",
    playlistUrl: "https://www.youtube.com/playlist?list=PL999",
    videoTotal: 128,
    creatorTotal: 96,
    slotFilled: 128,
    slotTotal: 160,
    dayMetric: { label: "募集締切まで", days: 12 },
    schedule: [
      { label: "募集期間", value: "09/01 - 10/16" },
      { label: "投稿期間", value: "11/03 - 11/04" },
    ],
    slotParts: [
      { label: "1日目 11.03", filled: 72, total: 80 },
      { label: "2日目 11.04", filled: 56, total: 80 },
    ],
    staff: [
      { name: "新概念", roleLabel: "代表", iconUrl: img("525c7209e503b8327cbd5bf4a64e5fc8.jpg"), xUserId: "shingainen", profileHref: "/user/shingainen" },
      { name: "スティックのり", roleLabel: null, iconUrl: img("f5c1a8af077b887c7bb1d043f3cf69c1.jpg"), xUserId: "stick", profileHref: null },
    ],
    videos: [
      { id: "e1", youtubeVideoId: "yt0000001", title: "【幼虫アニメ】◯◯◯でしますか？◯でしますか？", thumbnailUrl: img("525c7209e503b8327cbd5bf4a64e5fc8.jpg"), creatorName: "幼虫", durationLabel: "12:34" },
      { id: "e2", youtubeVideoId: null, title: "崇渦に関するお知らせ 前編", thumbnailUrl: img("191c3939aefb326fc04fd3ccf6db83a9.jpg"), creatorName: "おたこ", creatorIconUrl: img("fc027fe6fe3a001a22a1933270ce72b9.jpg"), durationLabel: "08:02" },
      { id: "e3", youtubeVideoId: "yt0000003", title: "【文字PV】スチールワンダー / はるまきごはん", thumbnailUrl: img("fc027fe6fe3a001a22a1933270ce72b9.jpg"), creatorName: "スティックのり", durationLabel: "06:10" },
    ],
  };
}

export function creatorFixture(img = (n) => `https://img.example/${n}`) {
  const card = (i, extra = {}) => ({
    href: `/w${i}`,
    title: `作品 ${i}`,
    thumbnailUrl: img(["3d8d62bbac75243d266ec6e3de039e6d.jpg", "191c3939aefb326fc04fd3ccf6db83a9.jpg", "755d245a064a6f5935c3dccd9a941048.jpg"][i % 3]),
    ...extra,
  });
  return {
    id: "012345rty",
    name: "おたこ",
    iconUrl: img("fc027fe6fe3a001a22a1933270ce72b9.jpg"),
    youtubeChannelUrl: "https://www.youtube.com/@otako",
    socialLinks: [{ label: "Web サイト", url: "https://example.com/" }],
    profileText: "アニメと実写を混ぜた短編を作っています。",
    contact: "依頼は X の DM へ。",
    works: {
      items: [1, 2, 3, 4].map((i) => card(i)),
      total: 10,
      currentPage: 1,
      totalPages: 2,
      pageSize: 4,
      buildHref: (p) => (p <= 1 ? "/user/012345rty" : `/user/012345rty?worksPage=${p}`),
    },
    collabs: {
      items: [5, 6].map((i) => card(i, { creatorName: "ホラー映画合作" })),
      total: 14,
      currentPage: 1,
      totalPages: 7,
      pageSize: 2,
      buildHref: (p) => (p <= 1 ? "/user/012345rty" : `/user/012345rty?collabPage=${p}`),
    },
  };
}
