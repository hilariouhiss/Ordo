import { computed, reactive } from "vue";
import { markPassDone, passQueue, passResolve } from "../model/ipc";
import type { PassAction, Task } from "../model/types";
import { todayIso } from "../lib/dates";

export function createPassVM() {
  const state = reactive({
    queue: [] as Task[],
    index: 0,
    open: false,
    busy: false,
    counts: { keep: 0, done: 0, suspend: 0, cancel: 0 },
  });

  const current = computed(() => state.queue[state.index] ?? null);

  async function start(): Promise<void> {
    const queue = await passQueue();
    // Nothing to go through: opening would show the "this round is done" screen for no reason.
    if (!queue.length) return;
    state.queue = queue;
    state.index = 0;
    state.counts = { keep: 0, done: 0, suspend: 0, cancel: 0 };
    state.open = true;
  }

  async function resolve(
    action: PassAction,
    suspendUntil: string | null = null,
    suspendReason: string | null = null,
  ): Promise<void> {
    const task = current.value;
    if (!task || state.busy) return;
    state.busy = true;
    try {
      await passResolve(task.id, action, suspendUntil, suspendReason);
      state.counts[action] += 1;
      state.index += 1;
    } finally {
      state.busy = false;
    }
  }

  async function finish(): Promise<void> {
    await markPassDone(todayIso());
    state.open = false;
    state.queue = [];
    state.index = 0;
    state.counts = { keep: 0, done: 0, suspend: 0, cancel: 0 };
  }

  // The card on screen, for opening the task sheet without leaving the pass.
  function splitCurrent(): Task | null {
    return current.value;
  }

  function close(): void {
    state.open = false;
  }

  return { state, current, start, resolve, finish, close, splitCurrent };
}

export const passVM = createPassVM();
