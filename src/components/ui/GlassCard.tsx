import * as React from "react";
import styles from "./GlassCard.module.css";

type GlassCardProps = {
  children: React.ReactNode;
  className?: string;
  tone?: "default" | "dark" | "accent";
};

export function GlassCard({
  children,
  className,
  tone = "default",
}: GlassCardProps): React.ReactElement {
  return (
    <section
      className={[styles.card, styles[tone], className]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </section>
  );
}
