/**
 * Icon palette shared by projects and namespaces: the editors store the icon's
 * *name* (a stable string in the backend `icon` column) and this map resolves
 * it back to a lucide component for rendering. Unknown/missing names fall back
 * to the folder icon.
 */

import type { Component } from "solid-js";
import {
  BookOpen,
  Briefcase,
  Bug,
  FolderKanban,
  GraduationCap,
  Hammer,
  Heart,
  Home,
  Rocket,
  ShoppingBag,
} from "lucide-solid";

type IconComponent = Component<{ size?: number | string }>;

export const ICONS: Record<string, IconComponent> = {
  folder: FolderKanban,
  rocket: Rocket,
  hammer: Hammer,
  book: BookOpen,
  briefcase: Briefcase,
  bug: Bug,
  home: Home,
  heart: Heart,
  graduation: GraduationCap,
  shopping: ShoppingBag,
};

/** Icon names offered by the editors, in display order. */
export const ICON_NAMES = Object.keys(ICONS);

export function getIcon(name: string | null | undefined): IconComponent {
  return (name && ICONS[name]) || FolderKanban;
}
