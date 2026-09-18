import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNow } from "../clock";

// The clock and the tick are faked so the test drives the minute boundary
// instead of waiting for it; nothing else is, so `waitFor` still works.
const BEFORE_MIDNIGHT = new Date(2026, 8, 9, 23, 59);

describe("createNow", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(BEFORE_MIDNIGHT);
  });
  afterEach(() => vi.useRealTimers());

  it("starts at the current instant", () => {
    createRoot((dispose) => {
      expect(createNow()()).toEqual(BEFORE_MIDNIGHT);
      dispose();
    });
  });

  it("re-reads the clock on the minute tick, crossing midnight", () => {
    createRoot((dispose) => {
      const now = createNow();
      vi.advanceTimersByTime(60_000);
      expect(now()).toEqual(new Date(2026, 8, 10, 0, 0));
      dispose();
    });
  });

  it("re-reads the clock when the window regains focus", () => {
    createRoot((dispose) => {
      const now = createNow();
      // A slept-through tick: time moved, no timer fired.
      vi.setSystemTime(new Date(2026, 8, 10, 9, 30));
      window.dispatchEvent(new Event("focus"));
      expect(now()).toEqual(new Date(2026, 8, 10, 9, 30));
      dispose();
    });
  });

  it("stops ticking and listening once its owner is disposed", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const dispose = createRoot((dispose) => {
      createNow();
      return dispose;
    });
    dispose();

    // Neither the interval nor the listener outlives the component that asked
    // for the clock (the leak QA-19 is about).
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith("focus", expect.any(Function));
    remove.mockRestore();
  });
});
