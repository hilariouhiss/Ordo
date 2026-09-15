import { beforeEach, describe, expect, it } from "vitest";
import * as store from "../store";
import type { Project } from "../types";

function project(id: string, overrides: Partial<Project> = {}): Project {
  return {
    id,
    name: `项目 ${id}`,
    description: null,
    color: null,
    icon: null,
    namespaceId: null,
    dueAt: null,
    status: "active",
    sortOrder: "n",
    createdAt: "2026-09-09T10:00:00Z",
    updatedAt: "2026-09-09T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  store.resetProjectsStore();
});

describe("projects store", () => {
  it("splits active and archived projects for the navigation", () => {
    store.setAll([
      project("a"),
      project("b", { status: "archived" }),
      project("c"),
    ]);

    expect(store.projectsState.loaded).toBe(true);
    expect(store.projectsState.projects).toHaveLength(3);
    expect(store.activeProjects().map((p) => p.id)).toEqual(["a", "c"]);
    expect(store.archivedProjects().map((p) => p.id)).toEqual(["b"]);
  });

  it("upserts by id and exposes getProject", () => {
    store.setAll([project("a")]);

    store.upsertProject(project("a", { name: "改名" }));
    expect(store.getProject("a")?.name).toBe("改名");

    store.upsertProject(project("b"));
    expect(store.projectsState.projects.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("patches only the given fields", () => {
    store.setAll([project("a")]);

    store.patchProject("a", { status: "archived" });

    const patched = store.getProject("a");
    expect(patched?.status).toBe("archived");
    expect(patched?.name).toBe("项目 a");
  });

  it("re-inserts at the original index when rolling back a removal", () => {
    store.setAll([project("a"), project("b"), project("c")]);

    store.removeProject("b");
    expect(store.projectsState.projects.map((p) => p.id)).toEqual(["a", "c"]);

    store.insertProjectAt(1, project("b"));
    expect(store.projectsState.projects.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });
});
