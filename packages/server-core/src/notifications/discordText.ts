export type DiscordBlock = {
  heading?: string;
  lines: Array<string | null | undefined | false>;
};

/** Discordメンション誤爆を防ぐためのエスケープ。 */
export function escapeDiscordMention(text: string): string {
  return text
    .replace(/@/g, "@\u200b")
    .replace(/</g, "\\<")
    .replace(/>/g, "\\>");
}
