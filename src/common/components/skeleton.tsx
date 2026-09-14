import { splitProps, type JSX } from "solid-js";

export type SkeletonProps = JSX.HTMLAttributes<HTMLDivElement> & {
  /** Sizing and shape; the shimmer itself comes from `skeleton`. */
  class?: string;
};

/**
 * One shimmering placeholder block. Compose these into the shape of whatever
 * is loading, so the layout does not jump when the real content arrives.
 *
 * Deliberately silent for assistive tech: the surrounding pane owns the single
 * `role="status"` announcement, and a skeleton read out element by element
 * would be noise.
 */
export function Skeleton(props: SkeletonProps) {
  const [local, rest] = splitProps(props, ["class"]);
  return <div aria-hidden="true" {...rest} class={`skeleton rounded-md ${local.class ?? ""}`} />;
}

export type SkeletonRowsProps = {
  /** The row widths, cycled. Varying them stops a stack of identical bars
   * reading as a table and makes the shimmer feel like content. */
  widths: string[];
  /** Row height in pixels, matching the real list's row height. */
  height?: number;
  /** Extra element rendered on the right of each row (e.g. a date chip). */
  trailing?: JSX.Element;
};

/**
 * Placeholder rows shaped like a task list row: checkbox, title, trailing chip.
 * Used by the task views and the project board.
 */
export function SkeletonRows(props: SkeletonRowsProps) {
  return (
    <div aria-hidden="true">
      {props.widths.map((width) => (
        <div
          class="flex items-center gap-3 border-b border-border pl-4 pr-3"
          style={{ height: `${props.height ?? 56}px` }}
        >
          <Skeleton class="size-4 shrink-0 rounded-[5px]" />
          <Skeleton class="h-3 min-w-0 shrink-0" style={{ width }} />
          {props.trailing}
        </div>
      ))}
    </div>
  );
}
