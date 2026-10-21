import { afterEach, describe, expect, it } from "vite-plus/test";
import { setLanguage } from "../i18n";
import { projectSummaryLine, type SummaryInput } from "../summary";

const project: SummaryInput = {
  name: "华东客户交付",
  dueDate: "2026-11-20",
  total: 3,
  done: 1,
  byCategory: [
    { name: "软件", total: 2, done: 1 },
    { name: "资料", total: 1, done: 0 },
  ],
};

afterEach(() => setLanguage("zh"));

describe("projectSummaryLine", () => {
  it("keeps the old Chinese wording", () => {
    expect(projectSummaryLine(project)).toBe(
      "华东客户交付 11/20 截止，3 项完成 1；软件 1/2，资料未动。",
    );
  });

  it("speaks English when the interface is English", () => {
    setLanguage("en");
    expect(projectSummaryLine(project)).toBe(
      "华东客户交付 due 11/20, 1 of 3 done; 软件 1/2, 资料 not started.",
    );
  });

  it("drops the due clause and category list when they are empty", () => {
    expect(
      projectSummaryLine({ name: "杂事", dueDate: null, total: 1, done: 0, byCategory: [] }),
    ).toBe("杂事，1 项完成 0。");
    setLanguage("en");
    expect(
      projectSummaryLine({ name: "Chores", dueDate: null, total: 1, done: 0, byCategory: [] }),
    ).toBe("Chores, 0 of 1 done.");
  });
});
