import { Show, type JSX } from "solid-js";

export interface DateFieldProps {
  /** Which native control is wrapped; it picks the placeholder wording. */
  type: "date" | "datetime-local";
  /** The field's current value — `""` is empty, which is when the native
   * segments are hidden and this placeholder shows instead. */
  value: string;
  /** The native input itself: normally `TextField.Input`, or a plain `<input>`
   * where the field does not sit inside a `TextField.Root`. It keeps its own
   * value/onChange wiring — this wrapper only owns the empty state. */
  children: JSX.Element;
}

/** Empty-state wording. No seconds: `datetime-local` keeps its default minute
 * precision, so promising `秒` would describe a field nobody can fill. */
const PLACEHOLDER: Record<DateFieldProps["type"], string> = {
  date: "年/月/日",
  "datetime-local": "年/月/日 时:分",
};

/**
 * Wraps a native date control so its empty state reads in Chinese (R6).
 *
 * The segment text Chromium paints into an empty `<input type="date">` comes
 * from the WebView's own UI language — on a mixed-locale Windows that is the
 * `yyyy/mm/日 --:--` this replaced — and no attribute, `lang` or style can
 * change it. So the segments are hidden while the field is empty and
 * unfocused (see `.date-field` in `index.css`) and this placeholder shows
 * through; focusing the field brings the segments back, which is how the user
 * actually types into it. The native calendar/clock picker is untouched.
 */
export function DateField(props: DateFieldProps) {
  return (
    <div class="date-field relative" data-empty={props.value ? undefined : ""}>
      {props.children}
      <Show when={!props.value}>
        <span
          aria-hidden="true"
          class="date-field-placeholder pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-subtle-foreground"
        >
          {PLACEHOLDER[props.type]}
        </span>
      </Show>
    </div>
  );
}
