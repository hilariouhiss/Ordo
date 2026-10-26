import { describe, expect, it } from "vite-plus/test";
import type { Priority, ProjectGroup, ProjectSummary } from "../../model/types";
import { projectSections } from "../projectGroups";

function group(id: string, name: string): ProjectGroup {
  return { id, name };
}

function project(
  id: string,
  groupId: string | null,
  name = id,
  priority: Priority = "normal",
): ProjectSummary {
  return { id, name, groupId, priority, total: 0, done: 0, byCategory: [] };
}

describe("projectSections", () => {
  it("keeps group order and sends unknown or missing groups to ungrouped", () => {
    const sections = projectSections(
      [project("a", "g1"), project("b", "missing"), project("c", null), project("d", "g2")],
      [group("g1", "甲方 A"), group("g2", "甲方 B"), group("g3", "空组")],
      "未分组",
      "en",
    );

    expect(sections.map((section) => [section.name, section.projects.map((p) => p.id)])).toEqual([
      ["甲方 A", ["a"]],
      ["甲方 B", ["d"]],
      ["空组", []],
      ["未分组", ["b", "c"]],
    ]);
  });

  it("sorts by importance then A-Z inside each section", () => {
    const sections = projectSections(
      [
        project("b", "g1", "Beta"),
        project("c", "g1", "Critical", "high"),
        project("a", "g1", "Alpha"),
        project("d", "g1", "Delta", "low"),
        project("u2", null, "Zulu"),
        project("u1", null, "Alpha", "high"),
      ],
      [group("g1", "甲方 A")],
      "未分组",
      "en",
    );

    expect(sections.map((section) => [section.name, section.projects.map((p) => p.id)])).toEqual([
      ["甲方 A", ["c", "a", "b", "d"]],
      ["未分组", ["u1", "u2"]],
    ]);
  });

  it("keeps the flat list when there are no groups", () => {
    expect(projectSections([project("a", null)], [], "未分组", "en")).toEqual([
      { id: "", name: "未分组", group: null, projects: [project("a", null)] },
    ]);
  });

  it("returns nothing when there are no projects and no groups", () => {
    expect(projectSections([], [], "未分组", "en")).toEqual([]);
  });
});
