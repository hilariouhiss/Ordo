import { For } from "solid-js";

export interface SegmentedControlProps<T extends string> {
  /** Accessible name of the button group. */
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

/** Small segmented control (range presets, grouping dimension). */
export function SegmentedControl<T extends string>(props: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={props.label}
      class="flex gap-0.5 rounded-md border border-border bg-surface p-0.5"
    >
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            aria-pressed={props.value === option.value}
            class={`rounded px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${
              props.value === option.value
                ? "bg-primary/10 font-medium text-primary"
                : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
            }`}
            onClick={() => props.onChange(option.value)}
          >
            {option.label}
          </button>
        )}
      </For>
    </div>
  );
}
