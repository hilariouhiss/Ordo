import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { defaultSettings } from "./fixtures";

const hoisted = vi.hoisted(() => {
  const window = {
    setMinSize: vi.fn().mockResolvedValue(undefined),
    setResizable: vi.fn().mockResolvedValue(undefined),
    setSkipTaskbar: vi.fn().mockResolvedValue(undefined),
    setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
    setAlwaysOnBottom: vi.fn().mockResolvedValue(undefined),
    setFocus: vi.fn().mockResolvedValue(undefined),
    show: vi.fn().mockResolvedValue(undefined),
    hide: vi.fn().mockResolvedValue(undefined),
    unminimize: vi.fn().mockResolvedValue(undefined),
    maximize: vi.fn().mockResolvedValue(undefined),
    isVisible: vi.fn().mockResolvedValue(true),
    isMinimized: vi.fn().mockResolvedValue(false),
    isMaximized: vi.fn().mockResolvedValue(false),
    scaleFactor: vi.fn().mockResolvedValue(1),
    onResized: vi.fn().mockResolvedValue(() => {}),
  };
  return {
    window,
    readDeskMonitors: vi.fn(),
    readWindowRect: vi.fn(),
    applyDeskPin: vi.fn().mockResolvedValue(undefined),
    setWindowRect: vi.fn().mockResolvedValue(undefined),
    setSettings: vi.fn().mockResolvedValue({}),
  };
});

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalSize: class {
    width: number;
    height: number;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
  },
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => hoisted.window,
  availableMonitors: vi.fn(),
  primaryMonitor: vi.fn(),
}));
vi.mock("../../model/ipc", () => ({
  setWindowRect: hoisted.setWindowRect,
  setSettings: hoisted.setSettings,
}));
vi.mock("../../lib/deskMonitors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/deskMonitors")>();
  return {
    ...actual,
    readDeskMonitors: hoisted.readDeskMonitors,
    readWindowRect: hoisted.readWindowRect,
    applyDeskPin: hoisted.applyDeskPin,
  };
});
vi.mock("../../lib/windowMotion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/windowMotion")>();
  // The glide is a native-window animation; these tests only need the state machine.
  return { ...actual, prefersReducedMotion: () => true };
});

const AREA = { x: 0, y: 0, width: 1920, height: 1080, scale: 1 };
const FULL_RECT = { position: { x: 100, y: 100 }, size: { width: 1100, height: 760 } };

function rectangle() {
  return {
    position: { ...FULL_RECT.position },
    size: { ...FULL_RECT.size },
  };
}

async function load(deskEnabled: boolean) {
  const { appVM } = await import("../appVM");
  const { windowModeVM } = await import("../windowModeVM");
  appVM.state.settings = { ...defaultSettings, deskEnabled };
  return { appVM, windowModeVM };
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.readWindowRect.mockResolvedValue(rectangle());
  hoisted.readDeskMonitors.mockResolvedValue({ list: [AREA], primary: AREA });
  hoisted.applyDeskPin.mockResolvedValue(undefined);
  hoisted.setWindowRect.mockResolvedValue(undefined);
  hoisted.setSettings.mockResolvedValue({});
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("windowModeVM", () => {
  it("starts straight into the widget shape when the setting says so", async () => {
    const { windowModeVM } = await load(true);

    await windowModeVM.init();

    expect(windowModeVM.state.mode).toBe("widget");
    expect(windowModeVM.state.phase).toBe("idle");
    expect(windowModeVM.state.appMounted).toBe(false);
    expect(windowModeVM.state.widgetMounted).toBe(true);
    expect(windowModeVM.state.widgetActive).toBe(true);
    expect(hoisted.window.setSkipTaskbar).toHaveBeenCalledWith(true);
    expect(hoisted.window.setResizable).toHaveBeenCalledWith(false);
  });

  it("returns to the full window from the widget", async () => {
    const { windowModeVM } = await load(true);
    await windowModeVM.init();

    await windowModeVM.enterFull({ reveal: true });

    expect(windowModeVM.state.mode).toBe("full");
    expect(windowModeVM.state.phase).toBe("idle");
    expect(windowModeVM.state.appMounted).toBe(true);
    expect(windowModeVM.state.widgetMounted).toBe(false);
    expect(hoisted.window.setResizable).toHaveBeenLastCalledWith(true);
    expect(hoisted.window.setSkipTaskbar).toHaveBeenLastCalledWith(false);
  });

  it("restores a usable window when a morph fails halfway", async () => {
    const { windowModeVM } = await load(false);
    await windowModeVM.init();
    expect(windowModeVM.state.mode).toBe("full");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    hoisted.window.setResizable.mockImplementationOnce(() => {
      throw new Error("boom");
    });

    await windowModeVM.enterWidget();

    expect(windowModeVM.state.mode).toBe("full");
    expect(windowModeVM.state.phase).toBe("idle");
    expect(windowModeVM.state.appMounted).toBe(true);
    expect(windowModeVM.state.widgetMounted).toBe(false);
    logged.mockRestore();
  });
});
