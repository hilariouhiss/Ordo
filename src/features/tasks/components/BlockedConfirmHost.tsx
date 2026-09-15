import { For, Show, createSignal } from "solid-js";
import { Button, Dialog } from "../../../common/components";
import { blockedRequest, clearBlockedConfirm } from "../blocked-confirm";

/**
 * The one place a blocked completion is confirmed. Mounted once by the app
 * shell, so none of the completion entry points has to know about it: they go
 * through `completeTask` (a child row goes through the same hook — it is a
 * task) and, for the board's drag, its move hook, which park the request here.
 *
 * Confirming replays the parked action itself — the hook that parked it wrote
 * `run`, so this component never branches on what kind of entity it is. The
 * request is dropped only once `run` reports success (`null` is the hooks'
 * failure answer): a failed write keeps the dialog, and its blocker list, on
 * screen.
 */
export function BlockedConfirmHost() {
  const request = () => blockedRequest();
  const [running, setRunning] = createSignal(false);

  async function confirm(): Promise<void> {
    const pending = request();
    if (!pending || running()) return;
    setRunning(true);
    let saved: unknown = null;
    try {
      saved = await pending.run();
    } finally {
      setRunning(false);
    }
    if (saved) clearBlockedConfirm();
  }

  return (
    <Show when={request()}>
      {(pending) => (
        <Dialog.Root
          open={true}
          onOpenChange={(open) => {
            if (!open) clearBlockedConfirm();
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay />
            <Dialog.Content aria-labelledby="blocked-confirm-title">
              <Dialog.Title id="blocked-confirm-title">前置尚未完成</Dialog.Title>
              <Dialog.Description>
                「{pending().title}」还有 {pending().blockers.length} 项前置未完成：
              </Dialog.Description>
              <Dialog.CloseButton aria-label="关闭" />

              <ul class="mt-3.5 flex flex-col gap-1.5">
                <For each={pending().blockers}>
                  {(blocker) => (
                    <li class="truncate rounded-md bg-surface-hover px-2.5 py-1.5 text-sm text-muted-foreground">
                      {blocker.title}
                    </li>
                  )}
                </For>
              </ul>

              <div class="mt-5 flex justify-end gap-2 border-t border-border pt-4">
                <Button variant="secondary" onClick={clearBlockedConfirm}>
                  取消
                </Button>
                <Button disabled={running()} onClick={() => void confirm()}>
                  仍要完成
                </Button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </Show>
  );
}
