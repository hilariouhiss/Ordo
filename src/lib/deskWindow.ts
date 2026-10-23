export type DeskEdge = "left" | "right" | "top" | "bottom";

export interface DeskPoint {
  x: number;
  y: number;
}

export interface DeskSize {
  width: number;
  height: number;
}

export interface DeskArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DeskRect {
  position: DeskPoint;
  size: DeskSize;
}

export function areaOf(workArea: { position: DeskPoint; size: DeskSize }): DeskArea {
  return {
    x: workArea.position.x,
    y: workArea.position.y,
    width: workArea.size.width,
    height: workArea.size.height,
  };
}

/** Card rect to window rect: the window carries the transparent room for the shadow. */
export function growRect(rect: DeskRect, by: number): DeskRect {
  return {
    position: { x: rect.position.x - by, y: rect.position.y - by },
    size: { width: rect.size.width + 2 * by, height: rect.size.height + 2 * by },
  };
}

export function shrinkRect(rect: DeskRect, by: number): DeskRect {
  return growRect(rect, -by);
}

export function clampToArea(position: DeskPoint, size: DeskSize, area: DeskArea): DeskPoint {
  return {
    x: Math.max(area.x, Math.min(position.x, area.x + area.width - size.width)),
    y: Math.max(area.y, Math.min(position.y, area.y + area.height - size.height)),
  };
}

/** The default dock: right edge, vertically centered in the work area. */
export function rightCenter(area: DeskArea, size: DeskSize): DeskPoint {
  return {
    x: area.x + Math.max(0, area.width - size.width),
    y: area.y + Math.max(0, Math.round((area.height - size.height) / 2)),
  };
}

function centerOf(position: DeskPoint, size: DeskSize): DeskPoint {
  return { x: position.x + size.width / 2, y: position.y + size.height / 2 };
}

function distanceTo(area: DeskArea, point: DeskPoint): number {
  const x = Math.max(area.x, Math.min(point.x, area.x + area.width));
  const y = Math.max(area.y, Math.min(point.y, area.y + area.height));
  return Math.hypot(x - point.x, y - point.y);
}

/** The monitor a saved window belongs to now; a removed monitor falls back. */
export function pickArea(
  saved: DeskPoint | null,
  size: DeskSize,
  monitors: DeskArea[],
  fallback: DeskArea,
): DeskArea {
  if (!saved || monitors.length === 0) return fallback;
  const center = centerOf(saved, size);
  const inside = monitors.find(
    (area) =>
      center.x >= area.x &&
      center.x <= area.x + area.width &&
      center.y >= area.y &&
      center.y <= area.y + area.height,
  );
  if (inside) return inside;
  return monitors.reduce(
    (best, area) => (distanceTo(area, center) < distanceTo(best, center) ? area : best),
    monitors[0],
  );
}

/** The edge the window was dropped near, or null when it sits free. */
export function nearestEdge(
  position: DeskPoint,
  size: DeskSize,
  area: DeskArea,
  tolerance: number,
): DeskEdge | null {
  const gaps: { edge: DeskEdge; gap: number }[] = [
    { edge: "left", gap: Math.abs(position.x - area.x) },
    { edge: "right", gap: Math.abs(area.x + area.width - (position.x + size.width)) },
    { edge: "top", gap: Math.abs(position.y - area.y) },
    { edge: "bottom", gap: Math.abs(area.y + area.height - (position.y + size.height)) },
  ];
  const hit = gaps.filter((one) => one.gap <= tolerance).sort((a, b) => a.gap - b.gap)[0];
  return hit?.edge ?? null;
}

export function snapToEdge(
  edge: DeskEdge,
  position: DeskPoint,
  size: DeskSize,
  area: DeskArea,
): DeskPoint {
  const point = clampToArea(position, size, area);
  switch (edge) {
    case "left":
      return { x: area.x, y: point.y };
    case "right":
      return { x: area.x + area.width - size.width, y: point.y };
    case "top":
      return { x: point.x, y: area.y };
    case "bottom":
      return { x: point.x, y: area.y + area.height - size.height };
  }
}

/** Where an edge-near card settles: clamped inside, then snapped flush if that lands near an edge. */
export function dockPoint(
  position: DeskPoint,
  size: DeskSize,
  area: DeskArea,
  tolerance: number,
): { position: DeskPoint; edge: DeskEdge | null } {
  const clamped = clampToArea(position, size, area);
  const edge = nearestEdge(clamped, size, area, tolerance);
  return {
    position: edge ? snapToEdge(edge, clamped, size, area) : clamped,
    edge,
  };
}

/** The tab left behind when the pointer leaves an edge-docked widget; its long side points into the screen. */
export function collapsedTab(
  edge: DeskEdge,
  expanded: DeskPoint,
  size: DeskSize,
  long: number,
  short: number,
  area: DeskArea,
): DeskRect {
  const point = clampToArea(expanded, size, area);
  const tile =
    edge === "left" || edge === "right"
      ? { width: long, height: short }
      : { width: short, height: long };
  const x = point.x + Math.round((size.width - tile.width) / 2);
  const y = point.y + Math.round((size.height - tile.height) / 2);
  switch (edge) {
    case "left":
      return { position: { x: area.x, y }, size: tile };
    case "right":
      return { position: { x: area.x + area.width - tile.width, y }, size: tile };
    case "top":
      return { position: { x, y: area.y }, size: tile };
    case "bottom":
      return { position: { x, y: area.y + area.height - tile.height }, size: tile };
  }
}
