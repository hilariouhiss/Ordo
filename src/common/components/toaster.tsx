import { For, onCleanup, onMount } from "solid-js";
import { X } from "lucide-solid";
import {
  dismissNotification,
  notifications,
  type AppNotification,
} from "../stores/notifications";

/** How long a notification stays before dismissing itself. */
const AUTO_DISMISS_MS = 6000;

function Toast(props: { item: AppNotification }) {
  onMount(() => {
    const timer = setTimeout(() => dismissNotification(props.item.id), AUTO_DISMISS_MS);
    onCleanup(() => clearTimeout(timer));
  });

  return (
    <div
      role={props.item.kind === "error" ? "alert" : "status"}
      class={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm shadow-sm ${
        props.item.kind === "error"
          ? "border-danger/40 bg-danger/10 text-danger"
          : "border-border bg-elevated text-foreground"
      }`}
    >
      <span class="min-w-0 flex-1 break-words">{props.item.message}</span>
      <button
        type="button"
        aria-label="关闭通知"
        class="-m-0.5 shrink-0 rounded p-0.5 opacity-60 outline-none transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
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
    <div aria-label="通知" class="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      <For each={notifications()}>{(item) => <Toast item={item} />}</For>
    </div>
  );
}
