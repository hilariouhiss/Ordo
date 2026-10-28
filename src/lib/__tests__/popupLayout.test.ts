import { describe, expect, it } from "vite-plus/test";
import {
  computePopupLayout,
  type PopupPanel,
  type PopupTrigger,
  type PopupViewport,
} from "../popupLayout";

const trigger = (top: number, left: number, width = 120, height = 24): PopupTrigger => ({
  top,
  left,
  bottom: top + height,
  width,
});
const viewport = (width = 1200, height = 800): PopupViewport => ({ width, height });
const panel = (width = 252, height = 300): PopupPanel => ({ width, height });

describe("computePopupLayout", () => {
  it("opens below the trigger when there is room", () => {
    const layout = computePopupLayout(trigger(100, 50), viewport(), panel());
    expect(layout).toMatchObject({ top: 128, left: 50, width: 252, above: false });
  });

  it("flips above near the bottom", () => {
    const layout = computePopupLayout(trigger(650, 50), viewport(1200, 800), panel(252, 300));
    expect(layout).toMatchObject({ top: 646 - 300, above: true, growHeight: 0 });
  });

  it("keeps a mini window popup below and reports the height to grow to", () => {
    const layout = computePopupLayout(trigger(40, 20), { width: 560, height: 96 }, panel(), {
      mini: true,
    });
    expect(layout).toMatchObject({ top: 68, above: false, growHeight: 40 + 24 + 4 + 300 + 12 });
  });

  it("clamps a panel that fits on neither side", () => {
    // Widget-sized window, field near the middle: 312px cannot go below or above.
    const layout = computePopupLayout(trigger(300, 50), viewport(560, 532), panel(254, 312));
    expect(layout.above).toBe(false);
    expect(layout.top).toBe(532 - 312 - 8);
    expect(layout.top + 312).toBeLessThanOrEqual(532 - 8);
  });

  it("clamps the panel to the viewport and follows the trigger width", () => {
    const clamped = computePopupLayout(trigger(100, 500), viewport(560, 800), panel());
    expect(clamped.left).toBe(560 - 252 - 8);

    const narrow = computePopupLayout(trigger(100, 500), viewport(300, 800), panel(400, 200));
    expect(narrow.width).toBe(284);
    expect(narrow.left).toBe(8);

    const wideTrigger = computePopupLayout(trigger(100, 20, 180), viewport(), panel(140, 200));
    expect(wideTrigger.width).toBe(180);
  });
});
