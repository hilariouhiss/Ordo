import { isTauri } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow, type Window } from "@tauri-apps/api/window";
import { nextTick, reactive } from "vue";
import { closeDialog, dialogRequest } from "../lib/dialog";
import {
  DESK_PAD,
  clampToArea,
  pickAreaForPoint,
  shrinkRect,
  widgetPlacement,
  type DeskPoint,
  type DeskRect,
  type DeskSize,
} from "../lib/deskWindow";
import { centeredFullRect, readDeskMonitors, readWindowRect } from "../lib/deskMonitors";
import { easeOutCubic, lerpRect, prefersReducedMotion } from "../lib/windowMotion";
import { setWindowRect } from "../model/ipc";
import { appVM } from "./appVM";
import { deskVM } from "./deskVM";
import { passVM } from "./passVM";
import { settingsVM } from "./settingsVM";
import { taskSheetVM } from "./taskSheetVM";

export type WindowMode = "full" | "widget";
export type ModePhase = "idle" | "to-widget" | "to-full";

/** Cross-fade between the two shapes; the native window travels for the glide. */
const FADE_MS = 160;
const GLIDE_MS = 260;
// Matches tauri.conf.json minWidth/minHeight.
const MIN_FULL = new LogicalSize(900, 620);

let cachedWindow: Window | null = null;
let fullRect: DeskRect | null = null;
let wasMaximized = false;
let initPromise: Promise<void> | null = null;
let queue: Promise<void> = Promise.resolve();
let animToken = 0;

function currentWindow(): Window {
  cachedWindow ??= getCurrentWindow();
  return cachedWindow;
}

function settings() {
  return appVM.state.settings;
}

function savedPoint(): DeskPoint | null {
  const current = settings();
  if (!current || current.deskX === null || current.deskY === null) return null;
  return { x: current.deskX, y: current.deskY };
}

function pin(): "top" | "bottom" {
  return settings()?.deskPin === "bottom" ? "bottom" : "top";
}

export function closeOverlays(): void {
  if (dialogRequest.value?.kind !== "notice") closeDialog(null);
  taskSheetVM.close();
  passVM.close();
  settingsVM.close();
}

function serialized(task: () => Promise<void>): Promise<void> {
  const next = queue.then(task, task).catch((error) => {
    // Let the next request retry from wherever the window stopped instead of locking the UI.
    console.error(error);
    state.phase = "idle";
  });
  queue = next;
  return next;
}

function sleep(ms: number): Promise<void> {
  if (prefersReducedMotion() || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Lets a freshly mounted layer paint its starting opacity before the class flips. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function stateFor(mode: WindowMode): void {
  state.mode = mode;
  state.phase = "idle";
  state.appMounted = mode === "full";
  state.appOpacity = mode === "full" ? 1 : 0;
  state.widgetMounted = mode === "widget";
  state.widgetActive = mode === "widget";
  state.widgetOpacity = mode === "widget" ? 1 : 0;
  state.collapsed = false;
}

async function readPlacement() {
  const { list, primary } = await readDeskMonitors();
  return widgetPlacement({ saved: savedPoint(), monitors: list, primary });
}

function flat(rect: DeskRect) {
  return {
    x: rect.position.x,
    y: rect.position.y,
    width: rect.size.width,
    height: rect.size.height,
  };
}

async function moveTo(rect: DeskRect): Promise<void> {
  await setWindowRect(rect.position.x, rect.position.y, rect.size.width, rect.size.height).catch(
    () => {},
  );
}

/** One command per frame lands position and size together; no half-moved frames. */
async function tweenTo(target: DeskRect): Promise<void> {
  const from = flat(await readWindowRect().catch(() => target));
  const to = flat(target);
  if (prefersReducedMotion()) {
    await moveTo(target);
    return;
  }
  const token = ++animToken;
  const started = performance.now();
  await new Promise<void>((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    // A hidden or throttled webview can stop requestAnimationFrame mid-glide.
    timer = setTimeout(() => {
      if (token === animToken) {
        animToken += 1;
        void moveTo(target);
      }
      finish();
    }, GLIDE_MS + 500);
    const step = (now: number): void => {
      if (token !== animToken) {
        finish();
        return;
      }
      const progress = Math.min(1, (now - started) / GLIDE_MS);
      const rect = lerpRect(from, to, easeOutCubic(progress));
      void setWindowRect(rect.x, rect.y, rect.width, rect.height).catch(() => {});
      if (progress < 1) requestAnimationFrame(step);
      else finish();
    };
    requestAnimationFrame(step);
  });
  if (token === animToken) await moveTo(target);
}

async function applyPin(): Promise<void> {
  const win = currentWindow();
  const top = pin() === "top";
  await win.setAlwaysOnTop(false).catch(() => {});
  await win.setAlwaysOnBottom(false).catch(() => {});
  if (top) await win.setAlwaysOnTop(true).catch(() => {});
  else await win.setAlwaysOnBottom(true).catch(() => {});
}

async function applyWidgetChrome(): Promise<void> {
  const win = currentWindow();
  // Clearing the minimum first lets the window shrink below 900x620.
  await win.setMinSize(null).catch(() => {});
  await win.setResizable(false).catch(() => {});
  await applyPin();
}

async function applyFullChrome(): Promise<void> {
  const win = currentWindow();
  await win.setSkipTaskbar(false).catch(() => {});
  await win.setAlwaysOnTop(false).catch(() => {});
  await win.setAlwaysOnBottom(false).catch(() => {});
  await win.setResizable(true).catch(() => {});
  // Only after the window has grown: tao re-applies the current size to the min bound.
  await win.setMinSize(MIN_FULL).catch(() => {});
  if (wasMaximized) await win.maximize().catch(() => {});
}

async function revealFull(): Promise<void> {
  const win = currentWindow();
  await win.show().catch(() => {});
  await win.unminimize().catch(() => {});
  await win.setFocus().catch(() => {});
}

/** Persists where the open panel stopped before the exit tween moves the window. */
async function saveWidgetSpot(): Promise<void> {
  if (state.collapsed) return;
  const rect = await readWindowRect().catch(() => null);
  if (!rect) return;
  const scale = await currentWindow()
    .scaleFactor()
    .catch(() => 1);
  const card = shrinkRect(rect, Math.round(DESK_PAD * scale));
  void deskVM.savePosition(card.position.x, card.position.y);
}

async function fullTarget(): Promise<DeskRect> {
  const rect = fullRect ?? (await readWindowRect());
  const { list, primary } = await readDeskMonitors();
  const area = pickAreaForPoint(rect.position, list, primary);
  const position = clampToArea(rect.position, rect.size satisfies DeskSize, area);
  return { position, size: rect.size };
}

async function doInit(): Promise<void> {
  if (!isTauri()) return;
  const win = currentWindow();
  wasMaximized = await win.isMaximized().catch(() => false);
  const rect = await readWindowRect().catch(() => null);
  const { primary } = await readDeskMonitors();
  const small = !rect || rect.size.width < MIN_FULL.width || rect.size.height < MIN_FULL.height;
  const full = small || !rect ? centeredFullRect(primary) : rect;
  fullRect = full;

  if (!settings()?.deskEnabled) {
    stateFor("full");
    if (small) {
      await moveTo(full);
      await applyFullChrome();
    }
    return;
  }

  // Start already as the widget, while the window is still hidden.
  state.mode = "widget";
  state.phase = "idle";
  state.appMounted = false;
  state.appOpacity = 0;
  state.widgetMounted = true;
  state.widgetActive = false;
  state.widgetOpacity = 1;
  if (wasMaximized) {
    await win.unmaximize().catch(() => {});
    const restored = await readWindowRect().catch(() => null);
    if (
      restored &&
      restored.size.width >= MIN_FULL.width &&
      restored.size.height >= MIN_FULL.height
    ) {
      fullRect = restored;
    }
  }
  await applyWidgetChrome();
  await moveTo((await readPlacement()).window);
  await win.setSkipTaskbar(true).catch(() => {});
  state.widgetActive = true;
}

/** Reads the current full-window rect and whether the OS has it maximized. */
async function rememberFullShape(): Promise<void> {
  const win = currentWindow();
  wasMaximized = await win.isMaximized().catch(() => false);
  const rect = await readWindowRect().catch(() => null);
  if (rect && rect.size.width >= MIN_FULL.width && rect.size.height >= MIN_FULL.height) {
    fullRect = rect;
  }
}

async function instantWidget(): Promise<void> {
  const win = currentWindow();
  state.phase = "to-widget";
  state.widgetMounted = true;
  state.widgetActive = false;
  state.widgetOpacity = 1;
  state.appMounted = false;
  state.appOpacity = 0;
  await nextTick();
  if (wasMaximized) {
    await win.unmaximize().catch(() => {});
    const restored = await readWindowRect().catch(() => null);
    if (
      restored &&
      restored.size.width >= MIN_FULL.width &&
      restored.size.height >= MIN_FULL.height
    ) {
      fullRect = restored;
    }
  }
  const placed = await readPlacement();
  await applyWidgetChrome();
  await moveTo(placed.window);
  await win.setSkipTaskbar(true).catch(() => {});
  await win.unminimize().catch(() => {});
  await win.show().catch(() => {});
  await win.setFocus().catch(() => {});
  state.widgetActive = true;
  state.mode = "widget";
  state.phase = "idle";
  state.collapsed = false;
  void deskVM.setEnabled(true);
}

async function doEnterWidget(): Promise<void> {
  if (state.phase !== "idle") return;
  if (state.mode === "widget") {
    await revealFull();
    return;
  }
  closeOverlays();
  await rememberFullShape();

  const win = currentWindow();
  const visible = await win.isVisible().catch(() => true);
  const minimized = await win.isMinimized().catch(() => false);
  if (!visible || minimized) {
    await instantWidget();
    return;
  }

  state.phase = "to-widget";
  state.widgetMounted = true;
  state.widgetActive = false;
  state.widgetOpacity = 0;
  await nextTick();
  await nextFrame();
  state.appOpacity = 0;
  if (!wasMaximized) state.widgetOpacity = 1;
  await sleep(FADE_MS);

  if (wasMaximized) {
    // Fade the app first, then restore; the card must not jump between centers.
    await win.unmaximize().catch(() => {});
    await nextTick();
    const restored = await readWindowRect().catch(() => null);
    if (
      restored &&
      restored.size.width >= MIN_FULL.width &&
      restored.size.height >= MIN_FULL.height
    ) {
      fullRect = restored;
    }
    state.widgetOpacity = 1;
    await sleep(FADE_MS);
  }

  state.appMounted = false;
  await applyWidgetChrome();
  await tweenTo((await readPlacement()).window);
  await win.setSkipTaskbar(true).catch(() => {});
  state.widgetActive = true;
  state.mode = "widget";
  state.phase = "idle";
  state.collapsed = false;
  void deskVM.setEnabled(true);
}

async function instantFull(reveal: boolean): Promise<void> {
  state.phase = "to-full";
  state.widgetActive = false;
  state.widgetOpacity = 0;
  await nextTick();
  state.widgetMounted = false;
  state.appMounted = true;
  state.appOpacity = 1;
  await moveTo(await fullTarget());
  await applyFullChrome();
  state.mode = "full";
  state.phase = "idle";
  state.collapsed = false;
  void deskVM.setEnabled(false);
  if (reveal) await revealFull();
}

async function doEnterFull(options: { reveal: boolean }): Promise<void> {
  if (state.phase !== "idle") return;
  if (state.mode === "full") {
    if (options.reveal) await revealFull();
    return;
  }
  closeOverlays();

  const win = currentWindow();
  const visible = await win.isVisible().catch(() => true);
  const minimized = await win.isMinimized().catch(() => false);
  if (!visible || minimized) {
    await instantFull(options.reveal);
    return;
  }

  await saveWidgetSpot();
  state.phase = "to-full";
  state.widgetActive = false;
  await nextTick();
  if (state.collapsed) state.widgetOpacity = 0;

  const target = await fullTarget();
  // Nothing is visible when the tab was collapsed, so do not spend the glide.
  if (state.collapsed) await moveTo(target);
  else await tweenTo(target);

  if (wasMaximized) {
    // The card is centered in the restored rect; hide it before the maximize jump.
    state.widgetOpacity = 0;
    await nextTick();
    await sleep(FADE_MS);
  }
  await applyFullChrome();

  state.appMounted = true;
  state.appOpacity = 0;
  await nextTick();
  await nextFrame();
  state.appOpacity = 1;
  state.widgetOpacity = 0;
  await sleep(FADE_MS);

  state.widgetMounted = false;
  state.widgetActive = false;
  state.mode = "full";
  state.phase = "idle";
  state.collapsed = false;
  void deskVM.setEnabled(false);
  await win.setFocus().catch(() => {});
}

export const state = reactive({
  mode: "full" as WindowMode,
  phase: "idle" as ModePhase,
  appMounted: true,
  appOpacity: 1,
  widgetMounted: false,
  widgetActive: false,
  widgetOpacity: 0,
  collapsed: false,
});

function init(): Promise<void> {
  initPromise ??= doInit().catch(() => {
    stateFor("full");
  });
  return initPromise;
}

async function enterWidget(): Promise<void> {
  if (!isTauri()) return;
  await init();
  await serialized(doEnterWidget);
}

async function enterFull(options?: { reveal?: boolean }): Promise<void> {
  if (!isTauri()) return;
  await init();
  await serialized(() => doEnterFull({ reveal: options?.reveal ?? true }));
}

async function ensureFull(): Promise<void> {
  if (!isTauri()) return;
  await init();
  await serialized(async () => {
    if (state.mode === "widget") await doEnterFull({ reveal: true });
    else await revealFull();
  });
}

async function setWidget(wanted: boolean): Promise<void> {
  if (!isTauri()) return;
  await init();
  await serialized(async () => {
    if (wanted) await doEnterWidget();
    else await doEnterFull({ reveal: false });
  });
}

function setCollapsed(collapsed: boolean): void {
  state.collapsed = collapsed;
}

export const windowModeVM = {
  state,
  init,
  enterWidget,
  enterFull,
  ensureFull,
  setWidget,
  setCollapsed,
};
