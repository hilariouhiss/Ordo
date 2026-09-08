/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import "./setup";
import { VirtualList } from "../virtual-list";

const ITEMS = Array.from({ length: 1000 }, (_, index) => `item-${index}`);

describe("VirtualList", () => {
  afterEach(cleanup);

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
});
