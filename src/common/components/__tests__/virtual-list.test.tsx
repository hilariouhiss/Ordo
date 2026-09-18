import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("keeps the focused row mounted when it scrolls out of the window", () => {
    // jsdom has no layout, so the viewport is steered by hand (see the resize
    // test below). Two visible rows plus the default overscan of 6 means a
    // scroll to row 100 leaves row 0 far outside the rendered window.
    const { container } = render(() => (
      <VirtualList items={ITEMS} itemHeight={48} getKey={(item) => item} class="overflow-y-auto">
        {(item) => <button type="button">{item}</button>}
      </VirtualList>
    ));

    const scroller = container.querySelector('[role="list"]') as HTMLElement;
    Object.defineProperty(scroller, "clientHeight", { get: () => 96, configurable: true });
    fireEvent.scroll(scroller);

    const button = scroller.querySelector("button") as HTMLButtonElement;
    button.focus();
    expect(document.activeElement).toBe(button);

    scroller.scrollTop = 4800;
    fireEvent.scroll(scroller);

    // Unmounting the row that owns focus drops focus to <body>: the keyboard
    // user loses their place in the list and has to tab in from the top again.
    expect(scroller.querySelector('[data-key="item-0"]')).toBeTruthy();
    expect(document.activeElement).toBe(button);
  });

  it("does not resurrect a row the list no longer has", () => {
    // The focused slot is kept mounted, and a shorter list moves that index out
    // of range: rendering it anyway would hand `children` an `undefined` item.
    const [items, setItems] = createSignal(ITEMS);
    const { container } = render(() => (
      <VirtualList
        items={items()}
        itemHeight={48}
        getKey={(item) => item}
        class="overflow-y-auto"
      >
        {(item) => <button type="button">{item}</button>}
      </VirtualList>
    ));

    const scroller = container.querySelector('[role="list"]') as HTMLElement;
    Object.defineProperty(scroller, "clientHeight", { get: () => 96, configurable: true });
    scroller.scrollTop = 4800;
    fireEvent.scroll(scroller);

    const button = scroller.querySelector("button") as HTMLButtonElement;
    button.focus();

    setItems(ITEMS.slice(0, 3));
    // The browser clamps a shrunken list back to the top (jsdom has no layout
    // and would leave `scrollTop` at 4800, past the end of three rows).
    scroller.scrollTop = 0;
    fireEvent.scroll(scroller);

    expect(scroller.querySelectorAll('[role="listitem"]').length).toBe(3);
    expect(scroller.textContent).toBe("item-0item-1item-2");
  });

  it("announces the true position and size of a virtualized row", () => {
    const { container } = render(() => (
      <VirtualList items={ITEMS} itemHeight={48} getKey={(item) => item} class="overflow-y-auto">
        {(item) => <span>{item}</span>}
      </VirtualList>
    ));

    const scroller = container.querySelector('[role="list"]') as HTMLElement;
    Object.defineProperty(scroller, "clientHeight", { get: () => 96, configurable: true });
    scroller.scrollTop = 4800;
    fireEvent.scroll(scroller);

    // Rendered window after scrolling to 4800px: rows 94..107 of 1000.
    const first = scroller.querySelector('[role="listitem"]') as HTMLElement;
    expect(first.dataset.key).toBe("item-94");
    // Without these, a screen reader reports the rendered window as the list.
    expect(first.getAttribute("aria-setsize")).toBe("1000");
    expect(first.getAttribute("aria-posinset")).toBe("95");
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
