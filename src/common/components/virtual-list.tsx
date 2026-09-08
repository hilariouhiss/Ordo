import { createMemo, createSignal, For, onMount, splitProps, type JSX } from "solid-js";

export type VirtualListProps<T> = {
  /** All items in source order. */
  items: readonly T[];
  /** Fixed row height in pixels (v1 does not measure rows). */
  itemHeight: number;
  /** Extra rows rendered above and below the viewport. */
  overscan?: number;
  /** Used as the row's `data-key` attribute (aids testing and debugging). */
  getKey?: (item: T, index: number) => string | number;
  /** Classes for the scroll container (must provide height + overflow). */
  class?: string;
  children: (item: T, index: number) => JSX.Element;
};

/**
 * Minimal fixed-height virtualizer: renders only the rows intersecting the
 * viewport (plus `overscan`), inside a spacer sized to the full list height.
 */
export function VirtualList<T>(props: VirtualListProps<T>) {
  const [local] = splitProps(props, ["overscan", "getKey"]);

  let containerRef: HTMLDivElement | undefined;
  const [scrollTop, setScrollTop] = createSignal(0);
  const [viewportHeight, setViewportHeight] = createSignal(0);

  const overscan = () => local.overscan ?? 6;
  const totalHeight = () => props.items.length * props.itemHeight;

  const range = createMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop() / props.itemHeight) - overscan());
    const end = Math.min(
      props.items.length,
      Math.ceil((scrollTop() + viewportHeight()) / props.itemHeight) + overscan(),
    );
    return { start, end };
  });

  const visible = createMemo(() => {
    const { start, end } = range();
    const rows: Array<{ item: T; index: number }> = [];
    for (let index = start; index < end; index++) {
      rows.push({ item: props.items[index], index });
    }
    return rows;
  });

  const handleScroll = () => {
    const el = containerRef;
    if (!el) return;
    setScrollTop(el.scrollTop);
    setViewportHeight(el.clientHeight);
  };

  onMount(handleScroll);

  return (
    <div ref={containerRef} role="list" class={props.class} onScroll={handleScroll}>
      <div style={{ position: "relative", height: `${totalHeight()}px` }}>
        <For each={visible()}>
          {(row) => (
            <div
              role="listitem"
              data-key={local.getKey?.(row.item, row.index)}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: `${props.itemHeight}px`,
                transform: `translateY(${row.index * props.itemHeight}px)`,
              }}
            >
              {props.children(row.item, row.index)}
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
