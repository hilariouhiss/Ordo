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
  });

  const current = computed(() => state.queue[state.index] ?? null);

  async function start(): Promise<void> {
    state.queue = await passQueue();
    state.index = 0;
    state.open = true;
  }

  async function resolve(action: PassAction, suspendUntil: string | null = null): Promise<void> {
    const task = current.value;
    if (!task || state.busy) return;
    state.busy = true;
    try {
      await passResolve(task.id, action, suspendUntil);
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
  }

  function close(): void {
    state.open = false;
  }

  return { state, current, start, resolve, finish, close };
}

export const passVM = createPassVM();
