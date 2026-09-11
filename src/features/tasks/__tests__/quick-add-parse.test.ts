/**
 * The quick-add input grammar (D-02): `@项目` / `!优先级` markers and Chinese
 * date phrases, all stripped from the title.
 *
 * Every case here pins a rule the user can predict; the ones marked 误判 guard
 * the false positives that would silently corrupt a title.
 */
import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "../quick-add-parse";

/** Wednesday, 9 September 2026, 10:00 local — the "now" every case sees. */
const NOW = new Date(2026, 8, 9, 10, 0, 0);

const PROJECTS = [
  { id: "p-work", name: "Work" },
  { id: "p-writing", name: "Writing" },
  { id: "p-home", name: "个人" },
];

/** Local wall-clock → UTC ISO, the shape `dueAt` travels in. */
function at(
  year: number,
  month: number,
  day: number,
  hour = 23,
  minute = 59,
  second = 59,
): string {
  return new Date(year, month - 1, day, hour, minute, second).toISOString();
}

function parse(text: string, projects = PROJECTS) {
  return parseQuickAdd(text, projects, NOW);
}

describe("parseQuickAdd: project markers", () => {
  it("takes the project off the end of the title", () => {
    expect(parse("写周报 @Work")).toEqual({
      title: "写周报",
      projectId: "p-work",
      priority: null,
      dueAt: null,
    });
  });

  it("matches the project name case-insensitively", () => {
    expect(parse("@wOrK 写周报").projectId).toBe("p-work");
  });

  it("matches a Chinese project name", () => {
    expect(parse("买菜 @个人").projectId).toBe("p-home");
  });

  it("accepts the full-width at sign a Chinese IME produces", () => {
    expect(parse("写周报 ＠Work").projectId).toBe("p-work");
  });

  it("resolves an unambiguous prefix", () => {
    expect(parse("写周报 @Wor").projectId).toBe("p-work");
  });

  it("ignores a prefix that fits more than one project", () => {
    // "Work" and "Writing" both start with W: guessing would be worse than not.
    expect(parse("写周报 @W")).toEqual({
      title: "写周报 @W",
      projectId: null,
      priority: null,
      dueAt: null,
    });
  });

  it("leaves an unknown @word in the title", () => {
    // Could genuinely be a mention of a person, not a project.
    expect(parse("等 @张三 回复")).toEqual({
      title: "等 @张三 回复",
      projectId: null,
      priority: null,
      dueAt: null,
    });
  });

  it("matches the longest project name when the marker runs into Chinese", () => {
    // Chinese titles rarely put a space after a Latin project name, so the
    // marker has to end itself: the longest project that prefixes the token.
    const projects = [
      { id: "p-work", name: "Work" },
      { id: "p-workout", name: "Workout" },
    ];
    expect(parse("写周报 @Workout明天", projects)).toEqual({
      title: "写周报",
      projectId: "p-workout",
      priority: null,
      dueAt: at(2026, 9, 10),
    });
    expect(parse("写周报 @Work明天", projects)).toEqual({
      title: "写周报",
      projectId: "p-work",
      priority: null,
      dueAt: at(2026, 9, 10),
    });
  });
});

describe("parseQuickAdd: priority markers", () => {
  it.each([
    ["写周报 !高", "high"],
    ["写周报 !中", "medium"],
    ["写周报 !低", "low"],
  ])("reads %s", (text, priority) => {
    expect(parse(text)).toEqual({
      title: "写周报",
      projectId: null,
      priority,
      dueAt: null,
    });
  });

  it("accepts the full-width exclamation mark", () => {
    expect(parse("写周报 ！高").priority).toBe("high");
  });

  it("does not treat a plain exclamation as a priority", () => {
    expect(parse("终于做完了!")).toEqual({
      title: "终于做完了!",
      projectId: null,
      priority: null,
      dueAt: null,
    });
  });
});

describe("parseQuickAdd: Chinese dates", () => {
  it.each([
    ["今天", at(2026, 9, 9)],
    ["明天", at(2026, 9, 10)],
    ["后天", at(2026, 9, 11)],
    ["大后天", at(2026, 9, 12)],
    ["3天后", at(2026, 9, 12)],
    ["2周后", at(2026, 9, 23)],
    ["9月30日", at(2026, 9, 30)],
    ["9月30号", at(2026, 9, 30)],
    ["2027年1月5日", at(2027, 1, 5)],
  ])("reads %s as a whole day", (text, dueAt) => {
    expect(parse(`写周报 ${text}`)).toEqual({
      title: "写周报",
      projectId: null,
      priority: null,
      dueAt,
    });
  });

  it.each([
    // now is Wednesday 2026-09-09
    ["周五", at(2026, 9, 11)],
    ["周三", at(2026, 9, 9)], // today still counts as "this Wednesday"
    ["星期一", at(2026, 9, 14)], // this Monday already passed → next one
    ["礼拜天", at(2026, 9, 13)],
    ["本周五", at(2026, 9, 11)],
    ["这周五", at(2026, 9, 11)],
    ["下周五", at(2026, 9, 18)],
    ["下下周一", at(2026, 9, 21)],
  ])("reads %s relative to the current week", (text, dueAt) => {
    expect(parse(`写周报 ${text}`).dueAt).toBe(dueAt);
  });

  it("rolls a month/day already past into next year", () => {
    expect(parse("写周报 9月1日").dueAt).toBe(at(2027, 9, 1));
  });

  it.each([
    ["明天下午3点", at(2026, 9, 10, 15, 0, 0)],
    ["明天上午9点15分", at(2026, 9, 10, 9, 15, 0)],
    ["周五晚上8点半", at(2026, 9, 11, 20, 30, 0)],
    ["明天中午12点", at(2026, 9, 10, 12, 0, 0)],
  ])("reads %s down to the minute", (text, dueAt) => {
    expect(parse(`写周报 ${text}`).dueAt).toBe(dueAt);
  });

  it.each([
    "完成 3/4 的报表", // slash dates are ambiguous with fractions: unsupported
    "春天来了",
  ])("leaves %s alone", (text) => {
    expect(parse(text)).toEqual({
      title: text,
      projectId: null,
      priority: null,
      dueAt: null,
    });
  });

  it("eats a date word even when it was meant as prose", () => {
    // The unavoidable cost of the feature. The quick-add window's live preview
    // is the mitigation: the user sees the title it will actually file.
    expect(parse("周日之前搞定")).toEqual({
      title: "之前搞定",
      projectId: null,
      priority: null,
      dueAt: at(2026, 9, 13),
    });
  });
});

describe("parseQuickAdd: everything at once", () => {
  it("pulls the project, priority and date out of one line", () => {
    expect(parse("写周报 @Work !高 明天下午3点")).toEqual({
      title: "写周报",
      projectId: "p-work",
      priority: "high",
      dueAt: at(2026, 9, 10, 15, 0, 0),
    });
  });

  it("tidies the whitespace the markers leave behind", () => {
    expect(parse("   写周报   @Work    !高   明天   ").title).toBe("写周报");
  });

  it("keeps a title that is nothing but markers as an empty title", () => {
    // The caller decides what an empty title means (it refuses to file one).
    expect(parse("@Work !高 明天").title).toBe("");
  });
});
