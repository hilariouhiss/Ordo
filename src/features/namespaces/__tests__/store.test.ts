import { beforeEach, describe, expect, it } from "vitest";
import * as projectsStore from "../../projects/store";
import type { Project } from "../../projects/types";
import * as store from "../store";
import type { Namespace } from "../types";

function namespace(id: string, overrides: Partial<Namespace> = {}): Namespace {
  return {
    id,
    name: `命名空间 ${id}`,
    description: null,
    color: null,
    icon: null,
    status: "active",
    sortOrder: "n",
    createdAt: "2026-09-15T10:00:00Z",
    updatedAt: "2026-09-15T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

function project(id: string, overrides: Partial<Project> = {}): Project {
  return {
    id,
    name: `项目 ${id}`,
    description: null,
    color: null,
    icon: null,
    namespaceId: null,
    status: "active",
    sortOrder: "n",
    createdAt: "2026-09-15T10:00:00Z",
    updatedAt: "2026-09-15T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  store.resetNamespacesStore();
  projectsStore.resetProjectsStore();
});

describe("namespaces store", () => {
  it("splits active and archived namespaces", () => {
    store.setAll([
      namespace("a"),
      namespace("b", { status: "archived" }),
      namespace("c"),
    ]);

    expect(store.namespacesState.loaded).toBe(true);
    expect(store.activeNamespaces().map((item) => item.id)).toEqual(["a", "c"]);
    expect(store.archivedNamespaces().map((item) => item.id)).toEqual(["b"]);
  });

  it("groups only live, active projects under a namespace", () => {
    store.setAll([namespace("ns1")]);
    projectsStore.setAll([
      project("p1", { namespaceId: "ns1" }),
      project("p2", { namespaceId: "ns1", status: "archived" }),
      project("p3"),
    ]);

    expect(store.projectsInNamespace("ns1").map((item) => item.id)).toEqual(["p1"]);
    expect(store.ungroupedProjects().map((item) => item.id)).toEqual(["p3"]);
  });

  it("falls back to the root list when the namespace is gone", () => {
    // No namespaces loaded at all: every filed project is an orphan.
    projectsStore.setAll([project("p1", { namespaceId: "ghost" })]);

    expect(store.isNamespaceLive("ghost")).toBe(false);
    expect(store.isNamespaceArchived("ghost")).toBe(false);
    expect(store.ungroupedProjects().map((item) => item.id)).toEqual(["p1"]);
  });

  it("keeps an archived namespace live, so its active projects are not ungrouped", () => {
    store.setAll([namespace("gone", { status: "archived" })]);
    projectsStore.setAll([project("p1", { namespaceId: "gone" })]);

    // Archived is not deleted: the project belongs to the archived group, not
    // to the root list (§5.5 forbids showing it in both).
    expect(store.isNamespaceLive("gone")).toBe(true);
    expect(store.isNamespaceArchived("gone")).toBe(true);
    expect(store.ungroupedProjects()).toEqual([]);
    expect(store.archivedProjectsOf("gone").map((item) => item.id)).toEqual(["p1"]);
  });

  it("keeps archived projects of a live namespace in the flat list", () => {
    store.setAll([namespace("live"), namespace("gone", { status: "archived" })]);
    projectsStore.setAll([
      project("p1", { namespaceId: "live", status: "archived" }),
      project("p2", { status: "archived" }),
      project("p3", { namespaceId: "gone", status: "archived" }),
      project("p4", { namespaceId: "gone" }),
    ]);

    expect(store.archivedLooseProjects().map((item) => item.id)).toEqual(["p1", "p2"]);
    expect(store.archivedProjectsOf("gone").map((item) => item.id)).toEqual(["p3", "p4"]);
  });

  it("upserts by id and patches fields", () => {
    store.setAll([namespace("a", { name: "旧名" })]);
    store.upsertNamespace(namespace("a", { name: "新名" }));
    expect(store.namespacesState.namespaces).toHaveLength(1);
    expect(store.getNamespace("a")?.name).toBe("新名");

    store.patchNamespace("a", { status: "archived" });
    expect(store.archivedNamespaces().map((item) => item.id)).toEqual(["a"]);

    store.removeNamespace("a");
    expect(store.namespacesState.namespaces).toEqual([]);
  });
});
