import type { Transition } from "motion-v";

export const easeOut = [0.22, 1, 0.36, 1];
export const springSoft: Transition = { type: "spring", stiffness: 300, damping: 32, mass: 0.9 };
export const springSnappy: Transition = { type: "spring", stiffness: 480, damping: 36 };

/** Rows: layout FLIP, rise in, shrink out. */
export const listItemMotion = {
  layout: true,
  initial: { opacity: 0, y: 6, scale: 0.985 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, scale: 0.97, transition: { duration: 0.14, ease: easeOut } },
  transition: springSnappy,
};

export const backdropMotion = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.18, ease: easeOut } },
  exit: { opacity: 0, transition: { duration: 0.14, ease: easeOut } },
};

export const modalPanelMotion = {
  initial: { opacity: 0, y: 18, scale: 0.92 },
  animate: { opacity: 1, y: 0, scale: 1, transition: springSoft },
  exit: { opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.14, ease: easeOut } },
};

export const sheetPanelMotion = {
  initial: { x: 72 },
  animate: { x: 0, transition: springSoft },
  exit: { x: 40, transition: { duration: 0.16, ease: easeOut } },
};

export const screenColumnMotion = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: springSoft },
  exit: { opacity: 0, y: 6, transition: { duration: 0.12 } },
};

export const passCardMotion = {
  initial: { opacity: 0, x: 28 },
  animate: { opacity: 1, x: 0, transition: springSnappy },
  exit: { opacity: 0, x: -28, transition: { duration: 0.16, ease: easeOut } },
};

export const panelSwapMotion = {
  initial: { opacity: 0, x: 8 },
  animate: { opacity: 1, x: 0, transition: { duration: 0.18, ease: easeOut } },
  exit: { opacity: 0, x: -8, transition: { duration: 0.12, ease: easeOut } },
};

const NAV_RANK: Record<string, number> = {
  week: 0,
  tasks: 1,
  projects: 2,
  categories: 3,
  tags: 4,
  people: 5,
  archive: 6,
};

export function pageRank(name: string | null | undefined): number {
  const key = name === "project" ? "projects" : (name ?? "week");
  return NAV_RANK[key] ?? 0;
}

export function pageDirection(
  from: string | null | undefined,
  to: string | null | undefined,
): 1 | -1 {
  return pageRank(to) >= pageRank(from) ? 1 : -1;
}

export function pageMotion(direction: number) {
  return {
    initial: { opacity: 0, x: direction * 24 },
    animate: { opacity: 1, x: 0, transition: springSnappy },
    exit: { opacity: 0, x: direction * -18, transition: { duration: 0.12, ease: easeOut } },
  };
}
