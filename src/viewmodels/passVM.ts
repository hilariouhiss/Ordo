import { computed, reactive } from "vue";
import { askNotice } from "../lib/dialog";
import { errorText, t } from "../lib/i18n";
import { markPassDone, passQueue, passResolve } from "../model/ipc";
import type { PassAction, Task } from "../model/types";
import { todayIso } from "../lib/dates";
import { appVM } from "./appVM";

export function createPassVM() {
  const state = reactive({
    queue: [] as Task[],
    index: 0,
    open: false,
    busy: false,
    counts: { keep: 0, done: 0, park: 0, cancel: 0 },
  });

  const current = computed(() => state.queue[state.index] ?? null);

  async function start(): Promise<void> {
    try {
      const queue = await passQueue();
      // Nothing to go through: opening would show the "this round is done" screen for no reason.
      if (!queue.length) return;
      state.queue = queue;
      state.index = 0;
      state.counts = { keep: 0, done: 0, park: 0, cancel: 0 };
      state.open = true;
    } catch (e) {
      void askNotice(t("common.actionFailed"), errorText(e));
    }
  }

  async function resolve(
    action: PassAction,
    parkUntil: string | null = null,
    parkReason: string | null = null,
    parkedOnId: string | null = null,
  ): Promise<void> {
    const task = current.value;
    if (!task || state.busy) return;
    state.busy = true;
    try {
      await passResolve(task.id, action, parkUntil, parkReason, parkedOnId);
      state.counts[action] += 1;
      state.index += 1;
    } catch (e) {
      // Stay on the card: the write did not land, so advancing would skip it silently.
      void askNotice(t("common.actionFailed"), errorText(e));
    } finally {
      state.busy = false;
    }
  }

  async function finish(): Promise<void> {
    try {
      const weekStart = await markPassDone(todayIso());
      if (appVM.state.settings) appVM.state.settings.lastPassWeek = weekStart;
    } catch (e) {
      // The week was not cleared; keep the pass open so the user can try again.
      void askNotice(t("common.actionFailed"), errorText(e));
      return;
    }
    state.open = false;
    state.queue = [];
    state.index = 0;
    state.counts = { keep: 0, done: 0, park: 0, cancel: 0 };
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
