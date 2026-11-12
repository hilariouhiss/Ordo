import { watch } from "vue";
import { todayIso } from "../lib/dates";
import { askAutoDefer, askNotice, dialogRequest } from "../lib/dialog";
import { errorText, t } from "../lib/i18n";
import { nextDeferDay } from "../lib/timing";
import * as ipc from "../model/ipc";
import type { OverdueTask } from "../model/types";
import { appVM } from "./appVM";
import { tasksVM } from "./tasksVM";
import { weekVM } from "./weekVM";
import { windowModeVM } from "./windowModeVM";

/**
 * The overdue queue: one defer dialog at a time, in finish-date order. A dismissed
 * dialog still answers with the default day, so the task always leaves the overdue set.
 */
export function createOverduePromptVM() {
  const queue: OverdueTask[] = [];
  let activeId: string | null = null;
  let running = false;
  let checking = false;

  function enqueue(tasks: OverdueTask[]): void {
    for (const task of tasks) {
      if (task.id === activeId || queue.some((queued) => queued.id === task.id)) continue;
      queue.push(task);
    }
    void run().catch(() => {});
  }

  /** The prompt must not cancel a dialog the user is already answering. */
  function dialogFree(): Promise<void> {
    if (!dialogRequest.value) return Promise.resolve();
    return new Promise((resolve) => {
      const stop = watch(dialogRequest, (request) => {
        if (request) return;
        stop();
        resolve();
      });
    });
  }

  async function run(): Promise<void> {
    if (running || queue.length === 0) return;
    running = true;
    try {
      // The user chose to be interrupted: bring the full window forward before asking.
      await windowModeVM.ensureFull();
      while (queue.length) {
        const settings = appVM.state.settings;
        if (settings && !settings.overduePrompt) {
          queue.length = 0;
          break;
        }
        await dialogFree();
        const task = queue.shift();
        if (!task) break;
        activeId = task.id;
        const fallback = nextDeferDay(task.expectedFinishDate, todayIso());
        const draft = await askAutoDefer(t("overdue.title", { title: task.title }), {
          finish: fallback,
          min: fallback,
          oldFinish: task.expectedFinishDate,
        });
        try {
          await ipc.deferTask(task.id, draft?.finish || fallback, draft?.reason ?? "");
          weekVM.reload();
          tasksVM.reload();
        } catch (e) {
          await askNotice(t("common.actionFailed"), errorText(e));
        } finally {
          activeId = null;
        }
      }
    } finally {
      running = false;
    }
  }

  async function check(): Promise<void> {
    if (checking) return;
    checking = true;
    try {
      enqueue(await ipc.listOverdueTasks());
    } catch {
      // The tick spends the day once; retry on our own until the read works again.
      setTimeout(() => void check(), 30_000);
    } finally {
      checking = false;
    }
  }

  /** Startup only asks after the 09:00 cut; before that the reminder tick owns it. */
  function startup(): void {
    if (new Date().getHours() < 9) return;
    void check();
  }

  return { check, startup };
}

export const overduePromptVM = createOverduePromptVM();
