import { describe, expect, it } from "vite-plus/test";
import type { Milestone } from "../../model/types";
import { isMilestoneOverdue, nextMilestone } from "../milestones";

function milestone(over: Partial<Milestone> = {}): Milestone {
  return { id: "m1", title: "方案评审", dueDate: "2026-11-20", doneAt: null, ...over };
}

describe("nextMilestone", () => {
  it("picks the earliest open milestone that has a day", () => {
    const next = nextMilestone([
      milestone({ id: "later", dueDate: "2026-12-05" }),
      milestone({ id: "done", dueDate: "2026-11-01", doneAt: "2026-10-30T00:00:00Z" }),
      milestone({ id: "undated", dueDate: null }),
      milestone({ id: "earliest", dueDate: "2026-11-20" }),
    ]);

    expect(next?.id).toBe("earliest");
  });

  it("is null when every milestone is done or undated", () => {
    expect(
      nextMilestone([
        milestone({ id: "done", doneAt: "2026-10-30T00:00:00Z" }),
        milestone({ id: "undated", dueDate: null }),
      ]),
    ).toBeNull();
    expect(nextMilestone([])).toBeNull();
  });
});

describe("isMilestoneOverdue", () => {
  it("is true only for an open milestone whose day has passed", () => {
    expect(isMilestoneOverdue(milestone({ dueDate: "2026-11-12" }), "2026-11-13")).toBe(true);
    expect(isMilestoneOverdue(milestone({ dueDate: "2026-11-13" }), "2026-11-13")).toBe(false);
    expect(
      isMilestoneOverdue(
        milestone({ dueDate: "2026-11-12", doneAt: "2026-11-13T00:00:00Z" }),
        "2026-11-13",
      ),
    ).toBe(false);
    expect(isMilestoneOverdue(milestone({ dueDate: null }), "2026-11-13")).toBe(false);
  });
});
