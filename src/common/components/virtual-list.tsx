import {
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  splitProps,
  type JSX,
} from "solid-js";

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
 * The row index a focus target sits in, or -1 when focus is not inside a row.
 * `closest` is guarded because a focus event's target is not necessarily an
 * element (it can be the document).
 */
function indexOfRow(target: EventTarget | null): number {
  const row = (target as Element | null)?.closest?.("[data-row-index]");
  const index = row?.getAttribute("data-row-index");
  return index ? Number(index) : -1;
}

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

  // Wrapper per index, kept across passes while the item in that slot is the
  // same object. `For` is keyed by reference, so handing it a fresh wrapper for
  // an unchanged item would destroy and rebuild the row — the caller's item
  // identity is only worth anything if this layer preserves it too.
  const rowCache = new Map<number, { item: T; index: number }>();

  /*
   * Index of the row that currently holds focus, or -1. A row scrolled out of
   * the window is unmounted, and unmounting the row that owns focus hands focus
   * back to `<body>`: a keyboard user who arrow-scrolls the list loses their
   * place and has to tab in from the top again. That one row is therefore kept
   * mounted, ahead of the window, while the rest of the list stays virtualized —
   * keeping the whole gap instead would un-virtualize the list the moment
   * someone scrolls away from their focus.
   */
  const [focusedIndex, setFocusedIndex] = createSignal(-1);

  const wrapperFor = (index: number) => {
    const item = props.items[index];
    const cached = rowCache.get(index);
    if (cached && cached.item === item) return cached;
    const row = { item, index };
    rowCache.set(index, row);
    return row;
  };

  const visible = createMemo(() => {
    const { start, end } = range();
    const focused = focusedIndex();
    // Only a slot the list still has: a shorter list moves the focused index out
    // of range, and keeping it mounted would hand the caller an `undefined` item.
    const kept =
      focused >= 0 && focused < props.items.length && (focused < start || focused >= end)
        ? focused
        : -1;
    const rows: Array<{ item: T; index: number }> = [];
    // Ahead of the window, not behind it: Tab from the kept row then lands on
    // the first row on screen instead of leaving the list.
    if (kept >= 0) rows.push(wrapperFor(kept));
    for (let index = start; index < end; index++) rows.push(wrapperFor(index));
    // Slots outside the window are not coming back into view unread, and an
    // unbounded map would grow with every scroll through a long list.
    for (const index of rowCache.keys()) {
      if ((index < start || index >= end) && index !== kept) rowCache.delete(index);
    }
    return rows;
  });

  const handleScroll = () => {
    const el = containerRef;
    if (!el) return;
    setScrollTop(el.scrollTop);
    setViewportHeight(el.clientHeight);
  };

  onMount(() => {
    handleScroll();
    // Resizes must re-sample the geometry too: the scroll handler alone
    // leaves a taller window blank below the fold until the user scrolls.
    const observer = new ResizeObserver(() => handleScroll());
    if (containerRef) observer.observe(containerRef);
    onCleanup(() => observer.disconnect());
  });

  return (
    <div
      ref={containerRef}
      role="list"
      class={props.class}
      onScroll={handleScroll}
      onFocusIn={(event) => setFocusedIndex(indexOfRow(event.target))}
      onFocusOut={(event) => {
        const next = event.relatedTarget as Node | null;
        if (!next || !containerRef?.contains(next)) setFocusedIndex(-1);
      }}
    >
      {/* `role="presentation"` so the spacer does not sit between the list and
          its items in the accessibility tree. */}
      <div role="presentation" style={{ position: "relative", height: `${totalHeight()}px` }}>
        <For each={visible()}>
          {(row) => (
            <div
              role="listitem"
              // A virtualized list announces the rendered window's length
              // unless every item reports where it sits in the real list.
              aria-setsize={props.items.length}
              aria-posinset={row.index + 1}
              data-row-index={row.index}
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
