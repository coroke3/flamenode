/**
 * 軽量 className マージヘルパー (Tailwind 非依存)。
 * truthy な文字列をスペース連結する。
 */
export function cn(...args: Array<string | undefined | null | false>): string {
  return args.filter(Boolean).join(" ");
}
