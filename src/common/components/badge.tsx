import { splitProps, type JSX } from "solid-js";

export type BadgeVariant = "default" | "outline" | "success" | "warning" | "danger";
export type BadgeSize = "sm" | "md";

export type BadgeProps = {
  variant?: BadgeVariant;
  size?: BadgeSize;
  class?: string;
  /** Hover tooltip. A Badge is a generic span, which ARIA forbids naming, so
   * this is the only way to add context to a badge whose text is terse. */
  title?: string;
  children: JSX.Element;
};

/*
 * Square-ish, not pill. A task row can carry four of these at once (priority,
 * two tags, a due date), and four pills in a row is the single most generic
 * look a list UI can have. The 5px radius still reads as a chip, but sits in
 * the same geometric family as the 8px buttons next to it — that 5px is the
 * theme's `--radius-selector`, which is also what daisyUI's `badge` class
 * uses, so the class brings the chip metrics and the variants bring the tint.
 *
 * The tints are daisyUI's `badge-soft` (8% of the status colour over the page
 * colour) — the same reasoning the hand-rolled /12 wash had: the semantic
 * tokens are darkened to pass contrast as text, so the wash stays light and
 * the label stays the dominant element.
 */
const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  default: "badge-ghost",
  outline: "badge-outline text-muted-foreground",
  success: "badge-soft badge-success",
  warning: "badge-soft badge-warning",
  danger: "badge-soft badge-error",
};

const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: "badge-sm h-[1.125rem] px-1.5 text-2xs",
  md: "badge-md h-5 px-2 text-xs",
};

export function Badge(props: BadgeProps) {
  const [local, rest] = splitProps(props, ["variant", "size", "class", "children"]);

  return (
    <span
      class={`badge shrink-0 gap-1 font-medium ${
        VARIANT_CLASSES[local.variant ?? "default"]
      } ${SIZE_CLASSES[local.size ?? "md"]} ${local.class ?? ""}`}
      {...rest}
    >
      {local.children}
    </span>
  );
}
