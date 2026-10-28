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
import {
  applyDeskPin,
  centeredFullRect,
  readDeskMonitors,
  readWindowRect,
} from "../lib/deskMonitors";
import {
  centerOffset,
  flatRect,
  prefersReducedMotion,
  rectScale,
  tweenRect,
  type Rect,
} from "../lib/windowMotion";
import { setWindowRect } from "../model/ipc";
import { appVM } from "./appVM";
import { deskVM } from "./deskVM";
import { passVM } from "./passVM";
import { projectsVM } from "./projectsVM";
import { quickCreateVM } from "./quickCreateVM";
import { settingsVM } from "./settingsVM";
import { taskSheetVM } from "./taskSheetVM";

export type WindowMode = "full" | "widget";
export type ModePhase = "idle" | "to-widget" | "to-full";

type FullTarget = { rect: DeskRect; css: DeskSize };

/** Cross-fade between the two shapes; the native window travels for the glide. */
const FADE_MS = 160;
const GLIDE_MS = 260;
/** Let the surface shrink visibly before it starts to dissolve. */
const MORPH_FADE_DELAY_MS = 40;
/** The widget card appears only once the glide is nearly at its corner. */
const MORPH_CARD_DELAY_MS = 120;
// Matches tauri.conf.json minWidth/minHeight.
const MIN_FULL = new LogicalSize(900, 620);

let cachedWindow: Window | null = null;
let fullRect: DeskRect | null = null;
let wasMaximized = false;
let initPromise: Promise<void> | null = null;
let queue: Promise<void> = Promise.resolve();
let animToken = 0;
let surfaceEl: HTMLElement | null = null;
let widgetLayerEl: HTMLElement | null = null;
let morphBase: DeskSize | null = null;
let morphObserver: ResizeObserver | null = null;
/** Inline styles the morph owns; v-show's `display` is never touched. */
const MORPH_STYLES = [
  "position",
  "top",
  "left",
  "width",
  "height",
  "transform",
  "transform-origin",
  "box-shadow",
  "will-change",
] as const;

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
  quickCreateVM.close();
  projectsVM.closeSettings();
}

function serialized(task: () => Promise<void>): Promise<void> {
  const next = queue.then(task, task).catch((error) => {
    // Let the next request retry from wherever the window stopped instead of locking the UI.
    console.error(error);
    stopMorph();
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
  stopMorph();
  state.widgetMounted = mode === "widget";
  state.widgetActive = mode === "widget";
  state.widgetOpacity = mode === "widget" ? 1 : 0;
  state.collapsed = false;
}

async function readPlacement() {
  const { list, primary } = await readDeskMonitors();
  return widgetPlacement({ saved: savedPoint(), monitors: list, primary });
}

async function moveTo(rect: DeskRect): Promise<void> {
  await setWindowRect(rect.position.x, rect.position.y, rect.size.width, rect.size.height).catch(
    () => {},
  );
}

/** One command per frame lands position and size together; no half-moved frames. */
async function tweenTo(target: DeskRect): Promise<void> {
  const from = flatRect(await readWindowRect().catch(() => target));
  if (prefersReducedMotion()) {
    await moveTo(target);
    return;
  }
  const token = ++animToken;
  await tweenRect(from, flatRect(target), GLIDE_MS, (rect) => {
    if (token !== animToken) return false;
    void setWindowRect(rect.x, rect.y, rect.width, rect.height).catch(() => {});
    return true;
  });
  if (token === animToken) await moveTo(target);
}

export function attachSurface(el: HTMLElement | null): void {
  surfaceEl = el;
  if (!el) stopMorph();
}

/** The widget layer holds the card; the exit keeps it on screen while the window jumps. */
export function attachWidgetLayer(el: HTMLElement | null): void {
  widgetLayerEl = el;
}

/** The surface follows the viewport the webview actually has, not the rect still in flight. */
function syncMorph(): void {
  if (!morphBase || !surfaceEl) return;
  const root = document.documentElement;
  const scale = rectScale(morphBase, {
    width: root.clientWidth,
    height: root.clientHeight,
  });
  surfaceEl.style.transform = `scale(${scale.x}, ${scale.y})`;
}

function styleSurface(base: DeskSize): void {
  if (!surfaceEl) return;
  surfaceEl.style.position = "absolute";
  surfaceEl.style.top = "0px";
  surfaceEl.style.left = "0px";
  surfaceEl.style.width = `${base.width}px`;
  surfaceEl.style.height = `${base.height}px`;
  surfaceEl.style.transformOrigin = "top left";
  surfaceEl.style.willChange = "transform";
}

function setSurfaceTransform(t: { x: number; y: number; scaleX: number; scaleY: number }): void {
  if (!surfaceEl) return;
  surfaceEl.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.scaleX}, ${t.scaleY})`;
}

/** Entering the widget: the window shrinks every frame, so the surface tracks the viewport. */
function startMorph(base: DeskSize): void {
  morphBase = base;
  styleSurface(base);
  if (surfaceEl) {
    // Same colour as the surface, so a 1px seam shows the app background, not the desktop.
    surfaceEl.style.boxShadow = "0 0 0 4px var(--color-base-200)";
  }
  // ResizeObserver runs after layout and before paint, so the surface tracks the viewport.
  morphObserver?.disconnect();
  morphObserver = new ResizeObserver(() => syncMorph());
  morphObserver.observe(document.documentElement);
  syncMorph();
}

function stopMorph(): void {
  morphObserver?.disconnect();
  morphObserver = null;
  morphBase = null;
  if (widgetLayerEl) widgetLayerEl.style.removeProperty("transform");
  if (!surfaceEl) return;
  for (const name of MORPH_STYLES) surfaceEl.style.removeProperty(name);
}

/** Resolves after the window resize landed: the viewport is the requested size (within rounding). */
function waitViewport(size: DeskSize, timeoutMs = 500): Promise<void> {
  const root = document.documentElement;
  const reached = (): boolean =>
    Math.abs(root.clientWidth - size.width) <= 1 && Math.abs(root.clientHeight - size.height) <= 1;
  if (reached()) return Promise.resolve();
  return new Promise((resolve) => {
    const observer = new ResizeObserver(() => {
      if (!reached()) return;
      observer.disconnect();
      clearTimeout(timer);
      resolve();
    });
    observer.observe(root);
    const timer = setTimeout(() => {
      observer.disconnect();
      resolve();
    }, timeoutMs);
  });
}

/**
 * Widget -> main: the window keeps the main size for the whole morph and only moves, so the
 * trailing edge never gets torn by a resize; the content scales inside it and lands exactly
 * on the full rect, making the final step a no-op.
 */
async function followMorphExit(w0: DeskRect, dpi: number, target: FullTarget): Promise<void> {
  const from = flatRect(w0);
  const to = flatRect(target.rect);
  const size = target.rect.size;
  const scaleTo = (rect: Rect): void => {
    const scale = rectScale(size, rect);
    setSurfaceTransform({ x: 0, y: 0, scaleX: scale.x, scaleY: scale.y });
  };
  const pinCard = (position: { x: number; y: number }): void => {
    if (!widgetLayerEl) return;
    const windowRect = { x: position.x, y: position.y, width: size.width, height: size.height };
    const offset = centerOffset(from, windowRect, dpi);
    widgetLayerEl.style.transform = `translate(${offset.x}px, ${offset.y}px)`;
  };

  styleSurface(target.css);
  state.appMounted = true;
  state.appOpacity = 0;
  scaleTo(from);
  await nextTick();
  // One resize while the app is hidden; from here on the window only moves.
  await moveTo({ position: w0.position, size });
  await waitViewport(target.css);
  pinCard(w0.position);
  state.widgetOpacity = 0;
  state.appOpacity = 1;
  await tweenRect(from, to, GLIDE_MS, (rect) => {
    void setWindowRect(rect.x, rect.y, size.width, size.height).catch(() => {});
    scaleTo(rect);
    pinCard(rect);
    return true;
  });
  await moveTo(target.rect);
  stopMorph();
}

async function applyWidgetChrome(): Promise<void> {
  const win = currentWindow();
  // Clearing the minimum first lets the window shrink below 900x620.
  await win.setMinSize(null).catch(() => {});
  await win.setResizable(false).catch(() => {});
  await applyDeskPin(win, pin());
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

/** The full-window rect plus the logical size its surface has to fill. */
async function fullTarget(): Promise<FullTarget> {
  const rect = fullRect ?? (await readWindowRect());
  const { list, primary } = await readDeskMonitors();
  const area = pickAreaForPoint(rect.position, list, primary);
  const position = clampToArea(rect.position, rect.size satisfies DeskSize, area);
  return {
    rect: { position, size: rect.size },
    css: {
      width: Math.round(rect.size.width / area.scale),
      height: Math.round(rect.size.height / area.scale),
    },
  };
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
  // Hide the surface before the jump so the card is not seen standing in the old window.
  state.appMounted = false;
  state.appOpacity = 0;
  stopMorph();
  state.widgetMounted = true;
  state.widgetActive = false;
  state.widgetOpacity = 0;
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
  state.widgetOpacity = 1;
  state.widgetActive = true;
  state.mode = "widget";
  state.phase = "idle";
  state.collapsed = false;
  void deskVM.setEnabled(true);
}

async function finishWidget(): Promise<void> {
  await currentWindow()
    .setSkipTaskbar(true)
    .catch(() => {});
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
  if (!visible || minimized || prefersReducedMotion()) {
    await instantWidget();
    return;
  }

  state.phase = "to-widget";
  state.widgetMounted = true;
  state.widgetActive = false;
  state.widgetOpacity = 0;

  if (wasMaximized) {
    // A native restore jump cannot be animated; fade the surface, restore, then glide the card.
    await nextTick();
    await nextFrame();
    state.appOpacity = 0;
    await sleep(FADE_MS);
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
    state.appMounted = false;
    await applyWidgetChrome();
    await tweenTo((await readPlacement()).window);
    await finishWidget();
    return;
  }

  const placed = await readPlacement();
  // Clearing the minimum first lets the window shrink below 900x620.
  await applyWidgetChrome();
  // The surface keeps its full layout size and shrinks with the window for the whole glide.
  startMorph({ width: window.innerWidth, height: window.innerHeight });
  await nextTick();
  await nextFrame();

  const glide = tweenTo(placed.window);
  await sleep(MORPH_FADE_DELAY_MS);
  state.appOpacity = 0;
  await sleep(MORPH_CARD_DELAY_MS);
  state.widgetOpacity = 1;
  await glide;

  state.appMounted = false;
  stopMorph();
  await finishWidget();
}

async function instantFull(reveal: boolean): Promise<void> {
  state.phase = "to-full";
  state.widgetActive = false;
  state.widgetOpacity = 0;
  await nextTick();
  state.widgetMounted = false;
  state.appMounted = true;
  state.appOpacity = 1;
  stopMorph();
  await moveTo((await fullTarget()).rect);
  await applyFullChrome();
  state.mode = "full";
  state.phase = "idle";
  state.collapsed = false;
  void deskVM.setEnabled(false);
  if (reveal) await revealFull();
}

async function finishFull(): Promise<void> {
  state.widgetMounted = false;
  state.widgetActive = false;
  state.appOpacity = 1;
  state.mode = "full";
  state.phase = "idle";
  state.collapsed = false;
  void deskVM.setEnabled(false);
  await currentWindow()
    .setFocus()
    .catch(() => {});
}

async function doEnterFull(options: { reveal: boolean }): Promise<void> {
  if (state.phase !== "idle") return;
  if (state.mode === "full") {
    if (options.reveal) await revealFull();
    return;
  }
  closeOverlays();

  const win = currentWindow();
  // A bottom-pinned widget sits under every window, and dropping that layer alone cannot
  // raise it (tao clears it with HWND_NOTOPMOST, a no-op for normal windows); pin top once
  // to lift the window, then unpin so the main shape lands on top of the normal band.
  await applyDeskPin(win, "top");
  await win.setAlwaysOnTop(false).catch(() => {});
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
  const w0 = await readWindowRect().catch(() => null);

  if (wasMaximized || state.collapsed || prefersReducedMotion() || !w0 || !widgetLayerEl) {
    // Nothing is visible when the tab was collapsed, so do not spend the glide.
    if (state.collapsed) await moveTo(target.rect);
    else await tweenTo(target.rect);

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

    await finishFull();
    return;
  }

  // The content morphs inside the union window; the native window is resized only twice.
  const dpi = await currentWindow()
    .scaleFactor()
    .catch(() => 1);
  await followMorphExit(w0, dpi, target);
  await applyFullChrome();
  await finishFull();
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
  attachSurface,
  attachWidgetLayer,
};
