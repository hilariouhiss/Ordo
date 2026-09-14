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
 * the same geometric family as the 8px buttons next to it.
 *
 * Tints sit at /12 rather than /15: the semantic tokens were darkened to pass
 * contrast as text, so a lighter wash keeps the label the dominant element.
 */
const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  default: "bg-surface-hover text-muted-foreground",
  outline: "border border-border text-muted-foreground",
  success: "bg-success/12 text-success",
  warning: "bg-warning/12 text-warning",
  danger: "bg-danger/12 text-danger",
};

const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: "h-[1.125rem] gap-1 px-1.5 text-2xs",
  md: "h-5 gap-1 px-2 text-xs",
};

export function Badge(props: BadgeProps) {
  const [local, rest] = splitProps(props, ["variant", "size", "class", "children"]);

  return (
    <span
      class={`inline-flex shrink-0 items-center rounded-[5px] font-medium ${
        VARIANT_CLASSES[local.variant ?? "default"]
      } ${SIZE_CLASSES[local.size ?? "md"]} ${local.class ?? ""}`}
      {...rest}
    >
      {local.children}
    </span>
  );
}
