import { For, onCleanup, onMount } from "solid-js";
import { X } from "lucide-solid";
import {
  dismissNotification,
  notifications,
  type AppNotification,
} from "../stores/notifications";

/** How long a notification stays before dismissing itself. */
const AUTO_DISMISS_MS = 6000;

/*
 * Toasts are the one floating surface that should feel like it arrives rather
 * than appears, so it slides up 8px while fading. The translate is on the
 * independent `translate` property, which keeps the stack's own layout
 * transform untouched.
 */
function Toast(props: { item: AppNotification }) {
  onMount(() => {
    const timer = setTimeout(() => dismissNotification(props.item.id), AUTO_DISMISS_MS);
    onCleanup(() => clearTimeout(timer));
  });

  return (
    <div
      role={props.item.kind === "error" ? "alert" : "status"}
      class={`animate-toast-in flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm shadow-lg ${
        props.item.kind === "error"
          ? "bg-danger-solid text-danger-foreground"
          : "bg-elevated text-foreground"
      }`}
    >
      <span class="min-w-0 flex-1 break-words">{props.item.message}</span>
      <button
        type="button"
        aria-label="关闭通知"
        class={`-m-0.5 shrink-0 rounded p-0.5 opacity-70 transition-opacity hover:opacity-100 focus-ring ${
          props.item.kind === "error" ? "text-danger-foreground" : "text-subtle-foreground"
        }`}
        onClick={() => dismissNotification(props.item.id)}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Bottom-right stack of in-app notifications (toasts). */
export function Toaster() {
  return (
    // No label of its own: every toast is its own live region (`role="alert"`
    // or `status`), so a label here would name nothing.
    <div class="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      <For each={notifications()}>{(item) => <Toast item={item} />}</For>
    </div>
  );
}
