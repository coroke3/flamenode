const LABELS: Record<string, string> = {
  draft: "下書き",
  pending: "審査待ち",
  public: "公開",
  limited: "限定公開",
  private: "非公開",
  hidden: "非表示",
  archived: "アーカイブ",
  voided: "停止",
};

export function videoVisibilityLabel(status: string): string {
  return LABELS[status] ?? status;
}

export function videoVisibilityBadgeClass(status: string): string {
  if (status === "public") return "fn-badge-accent";
  if (status === "pending") return "fn-badge-warning";
  if (status === "voided") return "fn-badge-danger";
  return "fn-badge-soft";
}
