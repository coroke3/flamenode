import fs from "node:fs";

const path = "src/components/user/AccountMenu.tsx";
let s = fs.readFileSync(path, "utf8");
const eol = s.includes("\r\n") ? "\r\n" : "\n";
s = s.replace(/\r\n/g, "\n");

// Fix accidental clearError() from partial patch first
s = s.replaceAll("clearError()", "setError(null)");

s = s.replace(
  `import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "./AccountMenu.module.css";
import { Icon } from "@/components/ui/Icon";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { setActiveXId } from "@/lib/actions/xid";
import { normalizeXId } from "@/lib/utils/xid";

export interface XIdEntry {
  x_user_id: string;
  x_name: string;
  icon_url: string | null;
  approval_status: "approved" | "pending" | "rejected";
  is_active: boolean;
}
`,
  `import * as React from "react";
import Link from "next/link";
import styles from "./AccountMenu.module.css";
import { Icon } from "@/components/ui/Icon";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import {
  sortXIdEntries,
  type XIdEntry,
} from "@/lib/xid/entries";
import { useActiveXSwitcher } from "./useActiveXSwitcher";
`,
);

s = s.replace(
  /function dedupeXIds\([\s\S]*?\n\}\n\n/,
  "",
);

s = s.replace(
  `}: AccountMenuProps): React.ReactElement {
  const router = useRouter();
  const xIds = React.useMemo(() => dedupeXIds(user.xIds), [user.xIds]);
  const [
    internalOpen,
    setInternalOpen,
  ] = React.useState(false);

  const open =
    controlledOpen ?? internalOpen;

  const setOpen = React.useCallback(
    (
      next:
        | boolean
        | ((current: boolean) => boolean),
    ) => {
      const resolved =
        typeof next === "function"
          ? next(open)
          : next;

      if (controlledOpen === undefined) {
        setInternalOpen(resolved);
      }

      onOpenChange?.(resolved);
    },
    [
      controlledOpen,
      onOpenChange,
      open,
    ],
  );
  const [error, setError] = React.useState<string | null>(null);
  const [activeId, setActiveId] = React.useState(
    xIds.find((e) => e.is_active)?.x_user_id ?? null,
  );
  const [pending, startTransition] = React.useTransition();
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setActiveId(xIds.find((e) => e.is_active)?.x_user_id ?? null);
  }, [xIds]);
`,
  `}: AccountMenuProps): React.ReactElement {
  const [
    internalOpen,
    setInternalOpen,
  ] = React.useState(false);

  const open =
    controlledOpen ?? internalOpen;

  const setOpen = React.useCallback(
    (
      next:
        | boolean
        | ((current: boolean) => boolean),
    ) => {
      const resolved =
        typeof next === "function"
          ? next(open)
          : next;

      if (controlledOpen === undefined) {
        setInternalOpen(resolved);
      }

      onOpenChange?.(resolved);
    },
    [
      controlledOpen,
      onOpenChange,
      open,
    ],
  );

  const {
    entries: xIds,
    activeId,
    activeEntry,
    pending,
    error,
    clearError,
    switchTo,
  } = useActiveXSwitcher({
    entries: user.xIds,
    onSwitch,
  });

  const ref = React.useRef<HTMLDivElement>(null);
`,
);

s = s.replace(
  `  // activeId に一致する entry のみを「現在のアクティブ」とみなす。
  // approved への暗黙フォールバックは、未選択なのにヘッダーで承認済み X ID が
  // アクティブに見える UX 不整合を生むため行わない。
  const activeEntry =
    xIds.find((e) => e.x_user_id === activeId) ?? null;

  const switchTo = (entry: XIdEntry) => {
    setError(null);
    if (entry.x_user_id === activeId) return;
    if (entry.approval_status === "rejected") {
      setError("却下された X ID はアクティブにできません。");
      return;
    }

    const prev = activeId;
    setActiveId(entry.x_user_id);
    const fd = new FormData();
    fd.set("x_user_id", entry.x_user_id);

    startTransition(async () => {
      const res = await setActiveXId(fd);
      if (res.ok) {
        onSwitch?.(entry.x_user_id);
        router.refresh();
      } else {
        setActiveId(prev);
        setError(res.message ?? "X ID の切り替えに失敗しました。");
      }
    });
  };

  // トリガー用のアイコンと名前
  const triggerIcon = activeEntry?.icon_url ?? user.image;
  const triggerName = activeEntry ? activeEntry.x_name : user.name?.trim() || "guest";

  const order = (s: XIdEntry["approval_status"]) =>
    s === "approved" ? 0 : s === "pending" ? 1 : 2;

  const selectableXIds = [...xIds]
    .filter((entry) => entry.approval_status !== "rejected")
    .sort(
      (a, b) =>
        order(a.approval_status) - order(b.approval_status) ||
        a.x_name.localeCompare(b.x_name, "ja"),
    );

  const hasPendingOnly =
    xIds.length > 0 &&
    xIds.every((entry) => entry.approval_status === "pending");

  const switchableXIds = activeEntry
    ? [...xIds]
        .filter((entry) => entry.x_user_id !== activeId)
        .sort(
          (a, b) =>
            order(a.approval_status) - order(b.approval_status) ||
            a.x_name.localeCompare(b.x_name, "ja"),
        )
    : [];
`,
  `  // トリガー用のアイコンと名前
  const triggerIcon = activeEntry?.icon_url ?? user.image;
  const triggerName = activeEntry ? activeEntry.x_name : user.name?.trim() || "guest";

  const selectableXIds =
    sortXIdEntries(
      xIds.filter(
        (entry) =>
          entry.approval_status !==
          "rejected",
      ),
    );

  const hasPendingOnly =
    xIds.length > 0 &&
    xIds.every((entry) => entry.approval_status === "pending");

  const switchableXIds =
    sortXIdEntries(
      xIds.filter(
        (entry) =>
          entry.x_user_id !== activeId,
      ),
    );
`,
);

s = s.replaceAll("setError(null)", "clearError()");

if (eol === "\r\n") s = s.replace(/\n/g, "\r\n");
fs.writeFileSync(path, s);
console.log("AccountMenu fixed");
console.log("has useActiveXSwitcher", s.includes("useActiveXSwitcher"));
console.log("has clearError", s.includes("clearError"));
console.log("has setActiveXId import", s.includes('from "@/lib/actions/xid"'));
console.log("has dedupe", s.includes("dedupeXIds"));
