import { Show, type JSX } from "solid-js";

export type EmptyStateProps = {
  /** A 20-22px icon from the app's set, drawn in a tinted tile. */
  icon?: JSX.Element;
  title: string;
  description?: string;
  /** The action that resolves the empty state, when there is one. */
  action?: JSX.Element;
  class?: string;
};

/**
 * The composed "nothing here yet" pane.
 *
 * Always offers the way out when one exists: an empty view that only *names*
 * the button to press ("click 新建任务 in the toolbar") makes the user hunt for
 * it. The tile is what stops this reading as a rendering failure rather than a
 * designed state.
 */
export function EmptyState(props: EmptyStateProps) {
  return (
    <div
      class={`flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center ${props.class ?? ""}`}
    >
      <Show when={props.icon}>
        <span class="flex size-11 items-center justify-center rounded-xl bg-surface-hover text-subtle-foreground">
          {props.icon}
        </span>
      </Show>
      <div class="flex flex-col gap-1">
        <h2 class="text-sm font-semibold text-foreground">{props.title}</h2>
        <Show when={props.description}>
          <p class="max-w-[40ch] text-sm text-muted-foreground">{props.description}</p>
        </Show>
      </div>
      <Show when={props.action}>
        <div class="pt-1">{props.action}</div>
      </Show>
    </div>
  );
}
