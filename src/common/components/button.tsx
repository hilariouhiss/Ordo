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
 *
 * The shape and the interaction states come from daisyUI's `btn`; the heights
 * and label sizes are overridden back to the desktop density the app has
 * always had (28/32/36px at 12/13px), because daisyUI's ladder starts at 32px.
 *
 * `destructive` paints the filled destructive pair the theme keeps under
 * `--ordo-error-solid`: `--color-error` is tuned to pass contrast as
 * destructively-coloured *text*, and in dark mode it is too light to carry
 * near-white ink.
 */
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  secondary: "btn",
  ghost: "btn-ghost",
  outline: "btn-outline",
  destructive:
    "btn-error [--btn-color:var(--ordo-error-solid)] [--btn-fg:var(--ordo-error-solid-content)]",
  /*
   * A quiet destructive action (delete, restore-from-backup). This exists as a
   * variant rather than `variant="ghost" class="text-error"` because that
   * combination silently does nothing: Tailwind resolves same-property
   * conflicts by CSS source order, and `.text-muted-foreground` is emitted
   * after `.text-error`, so ghost's own label colour always won and these
   * buttons rendered grey.
   */
  "destructive-ghost": "btn-ghost text-error hover:bg-error/12",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "btn-sm h-7 px-2.5 text-xs",
  md: "btn-md h-8 px-3 text-sm",
  lg: "btn-lg h-9 px-4 text-sm",
  icon: "btn-md btn-square size-8",
};

/**
 * Shared class for a square icon-only button (row actions, section actions,
 * list controls). Exported because six components used to carry their own
 * copy of this exact string — one definition is what keeps the hover, press
 * and disabled states identical everywhere.
 */
export const iconButtonClass =
  "btn btn-ghost btn-square btn-sm size-7 text-subtle-foreground transition duration-150 ease-out hover:bg-surface-hover hover:text-base-content active:scale-90 disabled:pointer-events-none disabled:opacity-30 focus-ring";

export function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, ["variant", "size", "class", "type", "children"]);

  return (
    <KButton
      type={local.type ?? "button"}
      class={`btn select-none font-medium transition duration-150 ease-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 focus-ring ${
        VARIANT_CLASSES[local.variant ?? "primary"]
      } ${SIZE_CLASSES[local.size ?? "md"]} ${local.class ?? ""}`}
      {...rest}
    >
      {local.children}
    </KButton>
  );
}
