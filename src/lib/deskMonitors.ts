import {
  availableMonitors,
  getCurrentWindow,
  primaryMonitor,
  type Monitor,
} from "@tauri-apps/api/window";
import type { DeskArea, DeskMonitor, DeskRect } from "./deskWindow";

/** tauri.conf.json's default main-window size, used when a widget start has no bigger rect. */
const FULL_WIDTH = 1100;
const FULL_HEIGHT = 760;

export function toDeskMonitor(monitor: Monitor): DeskMonitor {
  return {
    x: monitor.workArea.position.x,
    y: monitor.workArea.position.y,
    width: monitor.workArea.size.width,
    height: monitor.workArea.size.height,
    scale: monitor.scaleFactor,
  };
}

/** Monitor work areas in physical pixels; a failed query falls back to one screen. */
export async function readDeskMonitors(): Promise<{ list: DeskMonitor[]; primary: DeskMonitor }> {
  const [all, primary] = await Promise.all([
    availableMonitors().catch(() => [] as Monitor[]),
    primaryMonitor().catch(() => null),
  ]);
  const list = all.map(toDeskMonitor);
  const fallback = primary
    ? toDeskMonitor(primary)
    : (list[0] ?? { x: 0, y: 0, width: 1920, height: 1080, scale: 1 });
  if (list.length === 0) list.push(fallback);
  return { list, primary: primary ? toDeskMonitor(primary) : fallback };
}

/** The window's outer rect in physical pixels; frameless and shadowless, so outer = inner. */
export async function readWindowRect(): Promise<DeskRect> {
  const win = getCurrentWindow();
  const [position, size] = await Promise.all([win.outerPosition(), win.outerSize()]);
  return {
    position: { x: position.x, y: position.y },
    size: { width: size.width, height: size.height },
  };
}

/** Centered default main window for a widget start that has no remembered full rect. */
export function centeredFullRect(area: DeskArea): DeskRect {
  return {
    position: {
      x: area.x + Math.round((area.width - FULL_WIDTH) / 2),
      y: area.y + Math.round((area.height - FULL_HEIGHT) / 2),
    },
    size: { width: FULL_WIDTH, height: FULL_HEIGHT },
  };
}
