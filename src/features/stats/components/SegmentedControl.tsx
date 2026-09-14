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
      class="inline-flex gap-0.5 rounded-lg bg-sunken p-0.5"
    >
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            aria-pressed={props.value === option.value}
            class={`rounded-md px-2.5 py-1 text-xs transition duration-150 ease-out focus-ring ${
              props.value === option.value
                ? "bg-surface font-medium text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
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
