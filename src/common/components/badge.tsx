import { splitProps, type JSX } from "solid-js";

export type BadgeVariant = "default" | "outline" | "success" | "warning" | "danger";
export type BadgeSize = "sm" | "md";

export type BadgeProps = {
  variant?: BadgeVariant;
  size?: BadgeSize;
  class?: string;
  children: JSX.Element;
};

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  default: "bg-surface-hover text-foreground",
  outline: "border border-border text-muted-foreground",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/15 text-danger",
};

const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: "px-1.5 py-0.5 text-xs",
  md: "px-2 py-0.5 text-sm",
};

export function Badge(props: BadgeProps) {
  const [local, rest] = splitProps(props, ["variant", "size", "class", "children"]);

  return (
    <span
      class={`inline-flex items-center gap-1 rounded-full font-medium ${
        VARIANT_CLASSES[local.variant ?? "default"]
      } ${SIZE_CLASSES[local.size ?? "md"]} ${local.class ?? ""}`}
      {...rest}
    >
      {local.children}
    </span>
  );
}
