import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const toneClasses = {
  neutral: "border-[var(--color-border)] bg-[rgba(255,255,255,0.04)] text-[var(--color-quiet-ink)]",
  info: "border-[rgba(104,164,248,0.35)] bg-[rgba(104,164,248,0.12)] text-[#BBD6FF]",
  success: "border-[rgba(73,199,131,0.35)] bg-[rgba(73,199,131,0.12)] text-[#A9EBC7]",
  warning: "border-[rgba(241,184,91,0.4)] bg-[rgba(241,184,91,0.12)] text-[#F7D99F]",
  danger: "border-[rgba(255,127,114,0.4)] bg-[rgba(255,127,114,0.12)] text-[#FFC0B9]",
} as const;

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: keyof typeof toneClasses;
};

export function Badge({ className, children, tone = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
