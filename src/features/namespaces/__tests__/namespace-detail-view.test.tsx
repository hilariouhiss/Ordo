import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as projectsApi from "../../projects/api";
import { resetProjectsStore } from "../../projects/store";
import * as namespacesApi from "../api";
import { NamespaceDetailView } from "../components/NamespaceDetailView";
import { resetNamespacesStore } from "../store";

// The view only reads its route param; stubbing the router keeps this test free
// of router plumbing (the AppShell test owns the real one).
vi.mock("@tanstack/solid-router", () => ({
  Link: (props: { children?: unknown }) => <a href="/">{props.children as never}</a>,
  useParams: () => () => ({ namespaceId: "ns1" }),
}));

vi.mock("../api", () => ({
  listNamespaces: vi.fn(),
  createNamespace: vi.fn(),
  updateNamespace: vi.fn(),
  archiveNamespace: vi.fn(),
  restoreNamespace: vi.fn(),
}));

vi.mock("../../projects/api", () => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  archiveProject: vi.fn(),
  restoreProject: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  resetNamespacesStore();
  resetProjectsStore();
});

afterEach(cleanup);

describe("NamespaceDetailView", () => {
  // The group is derived from the projects, so a projects-only failure would
  // otherwise render an empty group ("0 个项目") with no retry in sight.
  it("offers a retry when only the projects fail to load", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([]);
    vi.mocked(projectsApi.listProjects).mockRejectedValue({
      code: "unknown",
      message: "项目加载失败",
    });

    render(() => <NamespaceDetailView />);

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
  });
});
