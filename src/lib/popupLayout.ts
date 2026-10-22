export interface PopupTrigger {
  top: number;
  left: number;
  bottom: number;
  width: number;
}

export interface PopupViewport {
  width: number;
  height: number;
}

export interface PopupPanel {
  width: number;
  height: number;
}

export interface PopupOptions {
  /** The capture window grows downward instead of flipping above. */
  mini?: boolean;
  gap?: number;
  margin?: number;
}

export interface PopupLayout {
  left: number;
  top: number;
  width: number;
  above: boolean;
  /** Viewport height the mini window needs for a panel placed below. */
  growHeight: number;
}

const DEFAULT_GAP = 4;
const DEFAULT_MARGIN = 8;
const GROW_SLACK = 12;

export function computePopupLayout(
  trigger: PopupTrigger,
  viewport: PopupViewport,
  panel: PopupPanel,
  options: PopupOptions = {},
): PopupLayout {
  const gap = options.gap ?? DEFAULT_GAP;
  const margin = options.margin ?? DEFAULT_MARGIN;
  const maxWidth = Math.max(0, viewport.width - margin * 2);
  const width = Math.min(Math.max(panel.width, trigger.width), maxWidth);
  const left = Math.max(margin, Math.min(trigger.left, viewport.width - width - margin));
  const roomBelow = trigger.bottom + gap + panel.height <= viewport.height - margin;
  const roomAbove = trigger.top - gap - panel.height >= margin;
  const above = options.mini !== true && !roomBelow && roomAbove;
  const top = above ? trigger.top - gap - panel.height : trigger.bottom + gap;
  const growHeight = above ? 0 : Math.ceil(trigger.bottom + gap + panel.height + GROW_SLACK);
  return { left, top, width, above, growHeight };
}
