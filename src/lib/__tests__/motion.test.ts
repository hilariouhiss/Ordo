import { describe, expect, it } from "vite-plus/test";
import { pageDirection, pageRank } from "../motion";

describe("page motion", () => {
  it("ranks nav pages in reading order and folds project detail into projects", () => {
    expect(pageRank("week")).toBe(0);
    expect(pageRank("archive")).toBe(6);
    expect(pageRank("project")).toBe(2);
    expect(pageRank(undefined)).toBe(0);
  });

  it("slides forward moving right and back moving left", () => {
    expect(pageDirection("week", "archive")).toBe(1);
    expect(pageDirection("archive", "week")).toBe(-1);
    expect(pageDirection("project", "projects")).toBe(1);
    expect(pageDirection("tags", "tags")).toBe(1);
  });
});
