import { onBeforeUnmount, ref, type Ref } from "vue";
import { isCaptureWindow, miniPopupHeight } from "./pickerWindow";
import { computePopupLayout, type PopupPanel } from "./popupLayout";

export interface AnchorPopupOptions {
  /** Called after every close; true when the close should return focus to the trigger. */
  onClosed?: (restoreFocus: boolean) => void;
}

export interface AnchorPopup {
  open: Ref<boolean>;
  /** The element the panel is anchored to (and clicks inside are not "outside"). */
  triggerRef: Ref<HTMLElement | null>;
  style: Ref<Record<string, string>>;
  panelId: string;
  show: (panel: PopupPanel) => void;
  close: (restoreFocus?: boolean) => void;
}

let popupSequence = 0;

export function useAnchorPopup(options: AnchorPopupOptions = {}): AnchorPopup {
  const open = ref(false);
  const triggerRef = ref<HTMLElement | null>(null);
  const style = ref<Record<string, string>>({});
  const panelId = `anchor-popup-${++popupSequence}`;
  let bound = false;

  function bind(): void {
    if (bound) return;
    bound = true;
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
  }

  function unbind(): void {
    if (!bound) return;
    bound = false;
    document.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("blur", onWindowBlur);
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onResize);
    document.removeEventListener("visibilitychange", onVisibility);
  }

  function show(panel: PopupPanel): void {
    if (open.value) return;
    const element = triggerRef.value;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const layout = computePopupLayout(
      { top: rect.top, left: rect.left, bottom: rect.bottom, width: rect.width },
      { width: window.innerWidth, height: window.innerHeight },
      panel,
      { mini: isCaptureWindow() },
    );
    style.value = {
      top: `${layout.top}px`,
      left: `${layout.left}px`,
      width: `${layout.width}px`,
    };
    // shortcut: the capture window only grows downward; move it too if a window
    // parked at the screen bottom ever clips a tall picker.
    miniPopupHeight.value = isCaptureWindow() && !layout.above ? layout.growHeight : 0;
    open.value = true;
    bind();
  }

  function close(restoreFocus = false): void {
    if (!open.value) return;
    open.value = false;
    miniPopupHeight.value = 0;
    unbind();
    options.onClosed?.(restoreFocus);
  }

  function onPointerDown(event: PointerEvent): void {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (isInsidePanel(target) || triggerRef.value?.contains(target)) return;
    close(false);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (!open.value || event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    close(true);
  }

  function onWindowBlur(): void {
    close(false);
  }

  function onScroll(event: Event): void {
    const target = event.target;
    if (target instanceof Node && isInsidePanel(target)) return;
    close(false);
  }

  function isInsidePanel(target: Node): boolean {
    return document.getElementById(panelId)?.contains(target) ?? false;
  }

  function onResize(): void {
    // The capture window grows itself to fit an open popup; ignore that resize.
    if (!isCaptureWindow()) close(false);
  }

  function onVisibility(): void {
    if (document.hidden) close(false);
  }

  onBeforeUnmount(() => {
    unbind();
    if (open.value) {
      open.value = false;
      miniPopupHeight.value = 0;
    }
  });

  return { open, triggerRef, style, panelId, show, close };
}
