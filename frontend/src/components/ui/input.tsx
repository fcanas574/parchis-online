import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "min-h-11 w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-input)] px-3.5 text-base text-[var(--color-parchment)] outline-none transition-[border-color,box-shadow,background-color] placeholder:text-[var(--color-quiet-ink)] hover:border-[var(--color-border-strong)] focus-visible:border-[var(--color-focus)] focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-room-night)] disabled:cursor-not-allowed disabled:opacity-45 aria-[invalid=true]:border-[var(--color-danger)] aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-[var(--color-danger)]",
      className,
    )}
    {...props}
  />
));

Input.displayName = "Input";
