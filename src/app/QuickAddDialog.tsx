import { createSignal, onCleanup, onMount } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button, Dialog, TextField } from "../common/components";
import { EVENTS } from "../common/ipc/events";
import { createTask } from "../features/tasks/hooks";

/**
 * Quick-add dialog (D-02): the global shortcut shows the window and emits
 * an event, which opens this one-field dialog. Submitting files the task
 * into the inbox and hides the window again — 录入即隐 — so a capture costs
 * the user two keystrokes and leaves whatever they were doing untouched.
 *
 * A failed create keeps the dialog (and the window) open: the optimistic
 * hooks already surfaced the error, and the typed title stays put.
 */
export default function QuickAddDialog() {
  const [open, setOpen] = createSignal(false);
  const [title, setTitle] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);

  onMount(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    listen(EVENTS.quickAdd, () => {
      setTitle("");
      setSubmitting(false);
      setOpen(true);
    })
      .then((stop) => {
        // The component may already be gone (or there is no Tauri runtime,
        // e.g. the browser dev server), in which case there is nothing to do.
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => {});

    onCleanup(() => {
      disposed = true;
      unlisten?.();
    });
  });

  /** Parks the window; nothing to hide outside a Tauri runtime. */
  async function hideWindow(): Promise<void> {
    try {
      await getCurrentWindow().hide();
    } catch {
      // Browser dev server: the dialog just closes.
    }
  }

  async function submit(): Promise<void> {
    const text = title().trim();
    if (!text || submitting()) return;

    setSubmitting(true);
    const created = await createTask({ title: text });
    setSubmitting(false);
    if (!created) return; // hooks notified; keep the form for a retry

    setOpen(false);
    await hideWindow();
  }

  return (
    <Dialog.Root open={open()} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content aria-labelledby="quick-add-title">
          <Dialog.Title id="quick-add-title">快速添加任务</Dialog.Title>
          <Dialog.Description>
            回车添加，任务进入收件箱；关掉后窗口自动隐藏。
          </Dialog.Description>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
          >
            <TextField.Root class="mt-3">
              <TextField.Input
                aria-label="任务标题"
                placeholder="要做点什么？"
                autofocus
                value={title()}
                onInput={(event) => setTitle(event.currentTarget.value)}
              />
            </TextField.Root>

            <div class="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button disabled={submitting()} onClick={() => void submit()}>
                添加
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
