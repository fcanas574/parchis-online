import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] border px-4 font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-150 enabled:cursor-pointer enabled:hover:-translate-y-px enabled:active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-room-night)] disabled:cursor-not-allowed disabled:opacity-45",
  {
    variants: {
      variant: {
        primary:
          "border-[var(--color-brass)] bg-[var(--color-brass)] text-[var(--color-room-night)] shadow-[0_8px_20px_rgba(10,7,15,0.28)] enabled:hover:bg-[#FFD07A]",
        secondary:
          "border-[var(--color-border)] bg-[var(--color-raised-felt)] text-[var(--color-parchment)] enabled:hover:border-[var(--color-brass-muted)] enabled:hover:bg-[#352B41]",
        ghost:
          "border-transparent bg-transparent text-[var(--color-quiet-ink)] enabled:hover:bg-[var(--color-raised-felt)] enabled:hover:text-[var(--color-parchment)]",
        danger:
          "border-[var(--color-danger)] bg-transparent text-[var(--color-danger)] enabled:hover:bg-[rgba(255,127,114,0.12)]",
      },
      size: {
        sm: "min-h-9 px-3 text-sm",
        md: "min-h-11 px-4 text-sm",
        lg: "min-h-12 px-5 text-base",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, type = "button", variant, size, onClick, ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      onClick={onClick}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);

Button.displayName = "Button";
