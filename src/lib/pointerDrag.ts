import { onBeforeUnmount, ref, shallowRef, type Ref, type ShallowRef } from "vue";

/** A drag only counts once the pointer really moved, so a click never turns into a drop. */
export const DRAG_THRESHOLD = 4;

/** Scrolling starts within this many pixels of the window edge. */
const SCROLL_EDGE = 56;
const SCROLL_STEP = 12;

/** The vertical scroll step for a pointer at `y` inside a `height`-tall window. */
export function edgeScroll(y: number, height: number): number {
  if (y < SCROLL_EDGE) return -SCROLL_STEP;
  if (y > height - SCROLL_EDGE) return SCROLL_STEP;
  return 0;
}

export interface PointerDrag<T> {
  /** The row being dragged, as given to `start`. */
  id: Ref<string | null>;
  /** What sits under the pointer, as `targetOf` reported it. */
  target: ShallowRef<T | null>;
  moved: Ref<boolean>;
  start: (event: PointerEvent, id: string) => void;
  move: (event: PointerEvent) => void;
  /** Releases the drag: hands the target to `drop` when the pointer really moved. */
  end: () => void;
  cancel: () => void;
}

/**
 * The pointer plumbing both week views share: the move threshold, the target under the
 * pointer, edge auto-scroll, and a drop only after a real move. `drop` runs while the
 * drag state is still set, so a caller can read what the drag is showing.
 */
export function usePointerDrag<T>(options: {
  /** The drop target under a viewport point, or null when there is none. */
  targetOf: (point: { x: number; y: number }) => T | null;
  /** The element that scrolls while the pointer sits near the window edge. */
  scroller: () => HTMLElement | null;
  drop: (id: string, target: T) => void;
}): PointerDrag<T> {
  const id = ref<string | null>(null);
  const target = shallowRef<T | null>(null);
  const moved = ref(false);
  let startX = 0;
  let startY = 0;
  let pointerX = 0;
  let pointerY = 0;
  let frame = 0;

  function refresh(): void {
    target.value = options.targetOf({ x: pointerX, y: pointerY });
  }

  function autoScroll(): void {
    if (!id.value) {
      frame = 0;
      return;
    }
    const delta = edgeScroll(pointerY, window.innerHeight);
    const scroller = options.scroller();
    if (!delta || !scroller) {
      frame = 0;
      return;
    }
    const before = scroller.scrollTop;
    scroller.scrollBy(0, delta);
    // The rows moved under a still pointer, so the target under it is stale.
    if (scroller.scrollTop !== before) refresh();
    frame = requestAnimationFrame(autoScroll);
  }

  function start(event: PointerEvent, rowId: string): void {
    id.value = rowId;
    target.value = null;
    moved.value = false;
    startX = pointerX = event.clientX;
    startY = pointerY = event.clientY;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent): void {
    if (!id.value) return;
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (
      !moved.value &&
      Math.abs(pointerX - startX) < DRAG_THRESHOLD &&
      Math.abs(pointerY - startY) < DRAG_THRESHOLD
    ) {
      return;
    }
    moved.value = true;
    refresh();
    if (!frame) frame = requestAnimationFrame(autoScroll);
  }

  function cancel(): void {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    id.value = null;
    target.value = null;
    moved.value = false;
  }

  function end(): void {
    const rowId = id.value;
    const hit = target.value;
    if (rowId !== null && moved.value && hit !== null) options.drop(rowId, hit);
    cancel();
  }

  onBeforeUnmount(cancel);

  return { id, target, moved, start, move, end, cancel };
}
