export function parseJstDatetimeLocal(
  raw: string | null | undefined,
): number | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  const m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!m) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : Math.floor(t / 1000);
  }

  const [, y, mo, d, h, mi, sec = "0"] = m;
  return Math.floor(
    Date.UTC(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h) - 9,
      Number(mi),
      Number(sec),
    ) / 1000,
  );
}
