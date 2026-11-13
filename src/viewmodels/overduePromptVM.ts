import { watch } from "vue";
import { todayIso } from "../lib/dates";
import { askNotice, askOverdueDefer, dialogRequest } from "../lib/dialog";
import { t } from "../lib/i18n";
import { nextDeferDay } from "../lib/timing";
import * as ipc from "../model/ipc";
import { appVM } from "./appVM";
import { tasksVM } from "./tasksVM";
import { weekVM } from "./weekVM";
import { windowModeVM } from "./windowModeVM";

/**
 * The overdue prompt: one dialog lists every overdue task, each row picking its own
 * day. Dismissing is still an answer, so the tasks move to their default day instead
 * of being asked about again.
 */
export function createOverduePromptVM() {
  let running = false;

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

  async function check(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const settings = appVM.state.settings;
      if (settings && !settings.overduePrompt) return;
      const tasks = await ipc.listOverdueTasks();
      if (tasks.length === 0) return;
      // The user chose to be interrupted: bring the full window forward before asking.
      await windowModeVM.ensureFull();
      await dialogFree();
      const fallback = nextDeferDay(tasks[0].expectedFinishDate, todayIso());
      const draft = await askOverdueDefer(
        t("overdue.summaryTitle", { count: tasks.length }),
        tasks,
        { finish: fallback, min: fallback },
      );
      const reason = draft?.reason ?? "";
      let failed = 0;
      for (const task of tasks) {
        const picked = draft?.dates.find((entry) => entry.id === task.id)?.finish;
        try {
          await ipc.deferTask(
            task.id,
            picked || nextDeferDay(task.expectedFinishDate, todayIso()),
            reason,
          );
        } catch {
          failed += 1;
        }
      }
      weekVM.reload();
      tasksVM.reload();
      if (failed > 0) {
        await askNotice(t("common.actionFailed"), t("overdue.someFailed", { count: failed }));
      }
    } catch {
      // The tick spends the day once; retry on our own until the read works again.
      setTimeout(() => void check(), 30_000);
    } finally {
      running = false;
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
