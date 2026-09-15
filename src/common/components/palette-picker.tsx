import { For, Show } from "solid-js";
import { Check } from "lucide-solid";
import { COLORS } from "../colors";
import { ICON_NAMES, getIcon } from "../icons";

/**
 * The palette controls shared by the project and namespace editors.
 *
 * A colour swatch is a click target, so it is `size-7` — at 24px a ten-colour
 * grid becomes a pixel hunt. Square, so it sits in the same geometric family
 * as the buttons under it. The border colour comes from the class rather than
 * an inline style, so `hover:border-border-strong` can actually win.
 */
const SWATCH_CLASS =
  "inline-flex size-7 items-center justify-center rounded-md border border-border transition focus-ring hover:border-border-strong active:scale-90";

export interface PalettePickerProps {
  value: string | null;
  onChange: (value: string | null) => void;
  /** Accessible name of the swatch/icon group, e.g. 「项目颜色」. */
  label: string;
}

export function ColorSwatches(props: PalettePickerProps) {
  return (
    <div class="flex flex-col gap-1.5">
      <span class="text-xs font-medium text-muted-foreground">颜色</span>
      <div role="group" aria-label={props.label} class="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          aria-label="无颜色"
          aria-pressed={props.value === null}
          class={`${SWATCH_CLASS} bg-surface text-2xs text-muted-foreground`}
          classList={{ "ring-2 ring-ring": props.value === null }}
          onClick={() => props.onChange(null)}
        >
          无
        </button>
        <For each={COLORS}>
          {(swatch) => (
            <button
              type="button"
              aria-label={`颜色 ${swatch}`}
              aria-pressed={props.value === swatch}
              class={SWATCH_CLASS}
              classList={{ "ring-2 ring-ring": props.value === swatch }}
              style={{ "background-color": swatch }}
              onClick={() => props.onChange(swatch)}
            >
              <Show when={props.value === swatch}>
                <Check size={13} class="text-white mix-blend-difference" aria-hidden="true" />
              </Show>
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

export function IconPicker(props: PalettePickerProps) {
  return (
    <div class="flex flex-col gap-1.5">
      <span class="text-xs font-medium text-muted-foreground">图标</span>
      <div role="group" aria-label={props.label} class="flex flex-wrap items-center gap-1.5">
        <For each={ICON_NAMES}>
          {(iconName) => {
            const Icon = getIcon(iconName);
            return (
              <button
                type="button"
                aria-label={`图标 ${iconName}`}
                aria-pressed={props.value === iconName}
                class="inline-flex size-8 items-center justify-center rounded-md border border-border bg-surface text-muted-foreground transition duration-150 ease-out hover:border-border-strong hover:bg-surface-hover active:scale-90 focus-ring"
                classList={{
                  "border-primary bg-primary/10 text-primary": props.value === iconName,
                }}
                onClick={() => props.onChange(iconName)}
              >
                <Icon size={15} />
              </button>
            );
          }}
        </For>
      </div>
    </div>
  );
}
