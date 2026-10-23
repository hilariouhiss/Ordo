import { computed, reactive } from "vue";
import { todayIso } from "../lib/dates";
import { groupPlannedDays, toPlanTask } from "../lib/plan";
import { planSchedule } from "../lib/schedule";
import {
  getSettings,
  listWeek,
  setSettings,
  setTaskStatus,
  startTask,
  suspendTask,
} from "../model/ipc";
import type { DeskPin, Settings, Task } from "../model/types";
import { appVM } from "./appVM";

export function createDeskVM() {
  const state = reactive({
    tasks: [] as Task[],
    loading: false,
    failed: false,
    busy: false,
    actionError: "",
    controls: true,
    pin: "top" as DeskPin,
  });

  const plan = computed(() => planSchedule(state.tasks.map(toPlanTask), todayIso()));
  const days = computed(() => groupPlannedDays(state.tasks, plan.value, todayIso()));
  const count = computed(() => state.tasks.length);

  async function load(): Promise<void> {
    state.loading = true;
    try {
      state.tasks = await listWeek();
      state.failed = false;
    } catch {
      state.failed = true;
    } finally {
      state.loading = false;
    }
  }

  async function loadConfig(): Promise<Settings> {
    const settings = await getSettings();
    state.pin = settings.deskPin === "bottom" ? "bottom" : "top";
    state.controls = settings.deskControls;
    return settings;
  }

  /** One mutation at a time; reload afterwards so the row leaves or changes state. */
  async function run(action: () => Promise<unknown>): Promise<void> {
    if (state.busy) return;
    state.busy = true;
    state.actionError = "";
    try {
      await action();
      await load();
    } catch (e) {
      state.actionError = String(e);
    } finally {
      state.busy = false;
    }
  }

  function start(task: Task): Promise<void> {
    return run(() => startTask(task.id));
  }

  /** The widget parks without a review date or reason; the main window keeps the full dialog. */
  function suspend(task: Task): Promise<void> {
    return run(() => suspendTask(task.id, null, null));
  }

  function complete(task: Task): Promise<void> {
    return run(() => setTaskStatus(task.id, "done"));
  }

  async function setPin(pin: DeskPin): Promise<void> {
    state.pin = pin;
    try {
      await setSettings({ deskPin: pin });
    } catch {
      // The z-order still changes for this session; the choice just won't survive a restart.
    }
  }

  async function savePosition(x: number, y: number): Promise<void> {
    try {
      await setSettings({ deskX: x, deskY: y });
    } catch {
      // The window stays where the user put it; only the next launch loses the spot.
    }
  }

  async function disable(): Promise<void> {
    try {
      await setSettings({ deskEnabled: false });
    } catch {
      // Leaving the window up is less surprising than an unhandled rejection.
    }
  }

  async function toggleEnabled(): Promise<void> {
    const enabled = !(appVM.state.settings?.deskEnabled ?? false);
    appVM.state.settings = await setSettings({ deskEnabled: enabled });
  }

  return {
    state,
    days,
    count,
    load,
    loadConfig,
    setPin,
    savePosition,
    disable,
    toggleEnabled,
    start,
    suspend,
    complete,
  };
}

export const deskVM = createDeskVM();
