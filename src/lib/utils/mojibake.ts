const BASE_MOJIBAKE_CODEPOINTS = [
  0xfffd,
  0x7e3a,
  0x7e67,
  0x8373,
  0x8b41,
  0x90b5,
  0x965e,
  0x9677,
  0x95d5,
  0x96b4,
] as const;

const SEO_MOJIBAKE_CODEPOINTS = [
  0x8b4f,
  0x8712,
  0x8753,
  0x879f,
  0x90a8,
  0x9695,
] as const;

export const MOJIBAKE_TOKENS: string[] = BASE_MOJIBAKE_CODEPOINTS.map((cp) =>
  String.fromCodePoint(cp),
);

const DETECTION_TOKENS = [
  ...MOJIBAKE_TOKENS,
  ...SEO_MOJIBAKE_CODEPOINTS.map((cp) => String.fromCodePoint(cp)),
];

export function looksLikeMojibake(s: string | null | undefined): boolean {
  if (!s) return false;
  if (DETECTION_TOKENS.some((token) => s.includes(token))) return true;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if ((c >= 0x00 && c <= 0x08) || (c >= 0x0b && c <= 0x1f)) return true;
  }
  return false;
}

export function mojibakeHitCount(s: string | null | undefined): number {
  if (!s) return 0;
  return DETECTION_TOKENS.reduce((count, token) => {
    let index = s.indexOf(token);
    while (index !== -1) {
      count++;
      index = s.indexOf(token, index + token.length);
    }
    return count;
  }, 0);
}
