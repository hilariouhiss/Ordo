import { computed, reactive } from "vue";
import { todayIso } from "../lib/dates";
import { groupPlannedDays, toPlanTask } from "../lib/plan";
import { planSchedule } from "../lib/schedule";
import { getSettings, listWeek, setSettings } from "../model/ipc";
import type { DeskPin, Settings, Task } from "../model/types";
import { appVM } from "./appVM";
import { taskRowVM } from "./taskRowVM";

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
  // The widget has room for one card per task, so a span stays on its start day.
  const days = computed(() =>
    groupPlannedDays(state.tasks, plan.value, todayIso(), undefined, false).filter(
      (day) => day.rows.length > 0,
    ),
  );
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
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    if (state.busy) return false;
    state.busy = true;
    state.actionError = "";
    try {
      await action();
      await load();
      return true;
    } catch (e) {
      state.actionError = String(e);
      return false;
    } finally {
      state.busy = false;
    }
  }

  // The row actions (and their undo) have one home; the widget only wraps them with its
  // own busy guard and reload.
  async function start(task: Task): Promise<void> {
    await run(() => taskRowVM.start(task));
  }

  /** The widget parks without a review date or reason; the main window keeps the full dialog. */
  async function suspend(task: Task): Promise<void> {
    await run(() => taskRowVM.suspend(task, null, null));
  }

  async function complete(task: Task): Promise<void> {
    await run(() => taskRowVM.toggleDone(task));
  }

  async function setPin(pin: DeskPin): Promise<void> {
    state.pin = pin;
    if (appVM.state.settings) appVM.state.settings.deskPin = pin;
    try {
      await setSettings({ deskPin: pin });
    } catch {
      // The z-order still changes for this session; the choice just won't survive a restart.
    }
  }

  async function savePosition(x: number, y: number): Promise<void> {
    // windowModeVM reads the in-memory copy to choose the next glide target, so update it
    // before the database round-trip; a failed write only costs the next launch's spot.
    if (appVM.state.settings) {
      appVM.state.settings.deskX = x;
      appVM.state.settings.deskY = y;
    }
    try {
      await setSettings({ deskX: x, deskY: y });
    } catch {
      // The window stays where the user put it; only the next launch loses the spot.
    }
  }

  /** The mode viewmodel persists the shape; failures only cost the next launch and the tray. */
  async function setEnabled(enabled: boolean): Promise<void> {
    try {
      appVM.state.settings = await setSettings({ deskEnabled: enabled });
    } catch {
      // The window still changes shape; the choice just will not survive a restart.
    }
  }

  return {
    state,
    days,
    count,
    load,
    loadConfig,
    setPin,
    savePosition,
    setEnabled,
    start,
    suspend,
    complete,
  };
}

export const deskVM = createDeskVM();
