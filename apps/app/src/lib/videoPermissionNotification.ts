// MIG-0715 U03: narrow CURRENT notification preview port. No send, network or browser-origin fallback.
// Origin must be supplied by the host from the same trusted public configuration as CURRENT.
export type NotificationUrlEnv = {
  NEXT_PUBLIC_SITE_URL?: string;
  NODE_ENV?: string;
};

type DiscordBlock = {
  heading?: string;
  lines: Array<string | null | undefined | false>;
};

type VideoEditPermissionGrantedNotification = {
  content: string;
  video_id?: string;
  url: string;
};

function notificationSiteOrigin(
  env: NotificationUrlEnv,
): string {
  const raw = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) throw new Error("NEXT_PUBLIC_SITE_URL_MISSING");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("NEXT_PUBLIC_SITE_URL_INVALID_ORIGIN");
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new Error("NEXT_PUBLIC_SITE_URL_INVALID_ORIGIN");
  }
  if (
    env.NODE_ENV === "production" &&
    (url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]")
  ) {
    throw new Error("NEXT_PUBLIC_SITE_URL_LOCALHOST_FORBIDDEN");
  }
  return url.origin;
}

function appUrl(
  path: string,
  env: NotificationUrlEnv,
): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || /^[/\\]{2}/.test(path)) {
    throw new Error("NOTIFICATION_PATH_MUST_BE_RELATIVE");
  }
  const origin = notificationSiteOrigin(env);
  const target = new URL(path.startsWith("/") ? path : `/${path}`, `${origin}/`);
  if (target.origin !== origin) throw new Error("NOTIFICATION_PATH_INVALID");
  return target.href;
}

function omitEmptyLines(
  lines: Array<string | null | undefined | false>,
): string[] {
  return lines.filter(
    (line): line is string => typeof line === "string" && line.trim().length > 0,
  );
}

function buildNotificationBlocks(blocks: DiscordBlock[]): string {
  const sections: string[] = [];
  for (const block of blocks) {
    const lines = omitEmptyLines(block.lines);
    if (block.heading) {
      sections.push(block.heading);
    }
    if (lines.length > 0) {
      sections.push(lines.join("\n"));
    }
  }
  return sections.join("\n\n");
}

function linkLine(
  label: string,
  path: string,
  env: NotificationUrlEnv,
): string {
  return `${label}\n${appUrl(path, env)}`;
}

function escapeDiscordMention(text: string): string {
  return text
    .replace(/@/g, "@\u200b")
    .replace(/</g, "\\<")
    .replace(/>/g, "\\>");
}

/** CURRENT payload subset for collaborative edit permission DM; preview only. */
export function buildVideoEditPermissionGrantedNotification(args: {
  videoId: string;
  videoTitle: string;
}, env: NotificationUrlEnv): VideoEditPermissionGrantedNotification {
  const editUrl = appUrl(`/dashboard/edit/${args.videoId}`, env);
  const title = escapeDiscordMention(args.videoTitle);
  const content = buildNotificationBlocks([
    {
      heading: "【FlameNode】作品の編集権限が付与されました",
      lines: [
        `作品「${title}」を共同編集できるようになりました。`,
        "タイトル・紹介文・メンバー情報など、許可された範囲を編集できます。",
      ],
    },
    {
      heading: "■ 次に行うこと",
      lines: [
        "編集画面を開き、担当範囲の修正を行ってください。",
        linkLine("編集画面を開く", `/dashboard/edit/${args.videoId}`, env),
      ],
    },
  ]);
  return {
    content,
    ...(args.videoId ? { video_id: args.videoId } : {}),
    url: editUrl,
  };
}
