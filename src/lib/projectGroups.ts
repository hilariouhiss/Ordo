import type { Priority, ProjectGroup, ProjectSummary } from "../model/types";

export interface ProjectSection {
  id: string;
  name: string;
  group: ProjectGroup | null;
  projects: ProjectSummary[];
}

const PRIORITY_RANK: Record<Priority, number> = { high: 0, normal: 1, low: 2 };

function rankOf(priority: Priority): number {
  return PRIORITY_RANK[priority] ?? PRIORITY_RANK.normal;
}

/** Splits projects into the configured groups, sorted by importance and then name. */
export function projectSections(
  projects: ProjectSummary[],
  groups: ProjectGroup[],
  ungroupedName: string,
  locale: string,
): ProjectSection[] {
  const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });
  const sorted = [...projects].sort((a, b) => {
    const rank = rankOf(a.priority) - rankOf(b.priority);
    if (rank !== 0) return rank;
    const byName = collator.compare(a.name, b.name);
    return byName !== 0 ? byName : a.id.localeCompare(b.id);
  });

  const known = new Set(groups.map((group) => group.id));
  const byGroup = new Map<string, ProjectSummary[]>();
  const ungrouped: ProjectSummary[] = [];
  for (const project of sorted) {
    if (!project.groupId || !known.has(project.groupId)) {
      ungrouped.push(project);
      continue;
    }
    const list = byGroup.get(project.groupId) ?? [];
    list.push(project);
    byGroup.set(project.groupId, list);
  }

  const sections: ProjectSection[] = groups.map((group) => ({
    id: group.id,
    name: group.name,
    group,
    projects: byGroup.get(group.id) ?? [],
  }));
  if (ungrouped.length) {
    sections.push({ id: "", name: ungroupedName, group: null, projects: ungrouped });
  }
  return sections;
}
