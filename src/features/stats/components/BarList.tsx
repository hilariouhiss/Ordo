import { For, Show, createMemo } from "solid-js";

export interface BarRow {
  id: string;
  label: string;
  /** Bar magnitude; the caller decides the scale via `max`. */
  value: number;
  /** Optional right-hand annotation (a count, a share, …). */
  hint?: string;
}

export interface BarListProps {
  rows: BarRow[];
  max: number;
  formatValue: (value: number) => string;
  emptyLabel: string;
}

/**
 * Horizontal bars for comparisons (project progress, time distribution).
 * The fill grows with a `scaleX` transform rather than a width animation, so
 * updates stay on the compositor (the plan's transform/opacity-only rule).
 */
export function BarList(props: BarListProps) {
  const peak = createMemo(() => Math.max(1, props.max));

  return (
    <Show
      when={props.rows.length > 0}
      fallback={<p class="py-2 text-sm text-subtle-foreground">{props.emptyLabel}</p>}
    >
      <ul class="flex flex-col gap-2">
        <For each={props.rows}>
          {(row) => (
            <li class="flex items-center gap-3">
              <span
                class="w-32 shrink-0 truncate text-sm text-foreground"
                title={row.label}
              >
                {row.label}
              </span>
              <span class="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-hover">
                <span
                  class="block h-full w-full origin-left rounded-full bg-primary"
                  style={{ transform: `scaleX(${Math.min(1, row.value / peak())})` }}
                />
              </span>
              <span class="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {props.formatValue(row.value)}
              </span>
              <Show when={row.hint}>
                <span class="w-24 shrink-0 text-right text-xs tabular-nums text-subtle-foreground">
                  {row.hint}
                </span>
              </Show>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
}
