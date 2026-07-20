import fs from "node:fs";

const files = [
  "src/lib/actions/rules.ts",
  "src/lib/actions/static-rebuild-admin.ts",
  "src/lib/actions/user-admin.ts",
  "src/lib/actions/moderation-admin.ts",
  "src/lib/actions/admin.ts",
  "src/lib/actions/event-admin.ts",
  "src/lib/actions/youtube-sync-admin.ts",
  "src/lib/actions/permissions-admin.ts",
  "src/lib/actions/notification-admin.ts",
  "src/lib/actions/broadcast-admin.ts",
  "src/lib/actions/api-endpoints.ts",
  "src/lib/actions/event-template-admin.ts",
];

for (const file of files) {
  let s = fs.readFileSync(file, "utf8");
  const before = s;
  let count = 0;

  // Normalize temporarily for matching, then write back with original EOL if needed
  const eol = s.includes("\r\n") ? "\r\n" : "\n";
  let n = s.replace(/\r\n/g, "\n");

  const pairs = [
    [
      'const db = getDatabase();\n  if (!db) return { ok: false, message: "DB に接続できません。" };',
      "const { db } = guard;",
    ],
    [
      'const db = getDatabase();\n  if (!db) return { ok: false, message: "DBに接続できません。" };',
      "const { db } = guard;",
    ],
    [
      'const db = getDatabase();\n  if (!db) throw new Error("DBに接続できません。");',
      "const { db } = guard;",
    ],
    [
      'const db = getDatabase(); if (!db) return { ok: false, message: "DB に接続できません。" };',
      "const { db } = guard;",
    ],
    [
      'const db = getDatabase(); if (!db) return { ok: false, message: "DBに接続できません。" };',
      "const { db } = guard;",
    ],
    [
      "const db = getDatabase(); if (!db) return;",
      "const { db } = guard;",
    ],
  ];

  for (const [from, to] of pairs) {
    while (n.includes(from)) {
      n = n.replace(from, to);
      count += 1;
    }
  }

  const withoutImport = n.replace(
    /import \{ getDatabase \} from "@\/lib\/cloudflare";\n/,
    "",
  );
  if (!/\bgetDatabase\b/.test(withoutImport)) {
    n = withoutImport;
  }

  s = eol === "\r\n" ? n.replace(/\n/g, "\r\n") : n;

  if (s !== before) {
    fs.writeFileSync(file, s);
    console.log(`updated ${file} (${count})`);
  } else {
    console.log(`NO CHANGE ${file}`);
  }
}
