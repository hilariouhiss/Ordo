import type { ProjectGroup, ProjectSummary } from "../model/types";

export interface ProjectSection {
  id: string;
  name: string;
  group: ProjectGroup | null;
  projects: ProjectSummary[];
}

/** Splits projects into the configured groups, with ungrouped projects last. */
export function projectSections(
  projects: ProjectSummary[],
  groups: ProjectGroup[],
  ungroupedName: string,
): ProjectSection[] {
  const known = new Set(groups.map((group) => group.id));
  const byGroup = new Map<string, ProjectSummary[]>();
  const ungrouped: ProjectSummary[] = [];
  for (const project of projects) {
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
