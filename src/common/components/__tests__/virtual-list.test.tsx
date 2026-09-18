/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./setup";
import { VirtualList } from "../virtual-list";

const ITEMS = Array.from({ length: 1000 }, (_, index) => `item-${index}`);

describe("VirtualList", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("renders only a window of rows inside a full-height spacer", () => {
    const { container } = render(() => (
      <VirtualList
        items={ITEMS}
        itemHeight={48}
        overscan={2}
        getKey={(item) => item}
        class="h-96 overflow-y-auto"
      >
        {(item) => <span>{item}</span>}
      </VirtualList>
    ));

    const scroller = container.querySelector('[role="list"]') as HTMLElement;
    const spacer = scroller.firstElementChild as HTMLElement;
    const rows = () => scroller.querySelectorAll('[role="listitem"]');

    expect(spacer.style.height).toBe("48000px");
    expect(rows().length).toBeLessThan(1000);
    expect((rows()[0] as HTMLElement).dataset.key).toBe("item-0");

    scroller.scrollTop = 2400;
    fireEvent.scroll(scroller);

    const first = rows()[0] as HTMLElement;
    expect(first.dataset.key).toBe("item-48");
    expect(first.style.transform).toBe("translateY(2304px)");
  });

  it("reveals rows when the container grows without a scroll in between", () => {
    // jsdom has no layout engine — `clientHeight` reads 0 and the setup's
    // ResizeObserver stub records nothing. Steer the element's height from
    // the test and swap in a recorder so the browser's resize notification
    // can be played by hand.
    const resizeCallbacks: ResizeObserverCallback[] = [];
    class ResizeObserverRecorder implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverRecorder);

    let clientHeight = 96;
    const { container } = render(() => (
      <VirtualList
        items={ITEMS}
        itemHeight={48}
        overscan={0}
        getKey={(item) => item}
        class="overflow-y-auto"
      >
        {(item) => <span>{item}</span>}
      </VirtualList>
    ));

    const scroller = container.querySelector('[role="list"]') as HTMLElement;
    const rows = () => scroller.querySelectorAll('[role="listitem"]');
    Object.defineProperty(scroller, "clientHeight", {
      get: () => clientHeight,
      configurable: true,
    });

    // Baseline: a scroll samples the geometry — 96px rows of 48px = 2 rows.
    fireEvent.scroll(scroller);
    expect(rows().length).toBe(2);

    // The window gets taller; nothing scrolls. Only the resize arrives.
    clientHeight = 288;
    for (const callback of resizeCallbacks) {
      callback([], {} as ResizeObserver);
    }

    expect(rows().length).toBe(6);
  });
});
