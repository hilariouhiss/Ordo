import { Button as KButton } from "@kobalte/core/button";
import { splitProps, type JSX } from "solid-js";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "outline"
  | "destructive"
  | "destructive-ghost";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

export type ButtonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  class?: string;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  onClick?: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>;
  children: JSX.Element;
};

/*
 * Pressing contracts the button by 3%. A colour shift alone reads as "hover,
 * again"; the contraction is what makes a click feel registered. It animates
 * the independent `scale` property, so it never triggers layout.
 */
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
  secondary:
    "border border-border bg-surface text-foreground shadow-sm hover:border-border-strong hover:bg-surface-hover",
  ghost: "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
  outline: "border border-border-strong bg-transparent text-foreground hover:bg-surface-hover",
  destructive: "bg-danger-solid text-danger-foreground hover:bg-danger-solid/90",
  /*
   * A quiet destructive action (delete, restore-from-backup). This exists as a
   * variant rather than `variant="ghost" class="text-danger"` because that
   * combination silently does nothing: Tailwind resolves same-property
   * conflicts by CSS source order, and `.text-muted-foreground` is emitted
   * after `.text-danger`, so ghost's own label colour always won and these
   * buttons rendered grey.
   */
  "destructive-ghost": "text-danger hover:bg-danger/12",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-7 gap-1.5 px-2.5 text-xs",
  md: "h-8 gap-1.5 px-3 text-sm",
  lg: "h-9 gap-2 px-4 text-sm",
  icon: "size-8",
};

/**
 * Shared class for a square icon-only button (row actions, section actions,
 * list controls). Exported because six components used to carry their own
 * copy of this exact string — one definition is what keeps the hover, press
 * and disabled states identical everywhere.
 */
export const iconButtonClass =
  "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-subtle-foreground transition duration-150 ease-out hover:bg-surface-hover hover:text-foreground active:scale-90 disabled:pointer-events-none disabled:opacity-30 focus-ring";

export function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, ["variant", "size", "class", "type", "children"]);

  return (
    <KButton
      type={local.type ?? "button"}
      class={`inline-flex shrink-0 select-none items-center justify-center rounded-md font-medium transition duration-150 ease-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 focus-ring ${
        VARIANT_CLASSES[local.variant ?? "primary"]
      } ${SIZE_CLASSES[local.size ?? "md"]} ${local.class ?? ""}`}
      {...rest}
    >
      {local.children}
    </KButton>
  );
}
