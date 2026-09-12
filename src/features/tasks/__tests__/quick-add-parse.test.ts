/**
 * The quick-add input grammar (D-02): `@项目`, `!高/!中/!低` and `#日期`.
 *
 * Every marker is explicit, including the date. A bare 明天 or 月底 is just
 * words in a title — the parser only reads a date when `#` introduces it, so
 * 「月底前完成报表」 can no longer be silently rewritten to 「前完成报表」.
 *
 * The ones marked 误判 guard the false positives that are still possible.
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

/** Same, but from a different "today" — for rules that depend on the date. */
function parseAt(text: string, now: Date) {
  return parseQuickAdd(text, PROJECTS, now);
}

/** The parse with nothing set: the line came through untouched. */
function untouched(text: string) {
  return { title: text, projectId: null, priority: null, dueAt: null };
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
    expect(parse("写周报 @W")).toEqual(untouched("写周报 @W"));
  });

  it("leaves an unknown @word in the title", () => {
    // Could genuinely be a mention of a person, not a project.
    expect(parse("等 @张三 回复")).toEqual(untouched("等 @张三 回复"));
  });

  it("matches the longest project name when the marker runs into Chinese", () => {
    // Chinese titles rarely put a space after a Latin project name, so the
    // marker has to end itself: the longest project that prefixes the token.
    const projects = [
      { id: "p-work", name: "Work" },
      { id: "p-workout", name: "Workout" },
    ];
    expect(parse("写周报 @Workout#明天", projects)).toEqual({
      title: "写周报",
      projectId: "p-workout",
      priority: null,
      dueAt: at(2026, 9, 10),
    });
    expect(parse("写周报 @Work#明天", projects)).toEqual({
      title: "写周报",
      projectId: "p-work",
      priority: null,
      dueAt: at(2026, 9, 10),
    });
  });

  it("ends the project name at the next marker", () => {
    expect(parse("@Work#明天")).toEqual({
      title: "",
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
    expect(parse("终于做完了!")).toEqual(untouched("终于做完了!"));
  });
});

describe("parseQuickAdd: # introduces the due date", () => {
  it.each([
    ["#今天", at(2026, 9, 9)],
    ["#明天", at(2026, 9, 10)],
    ["#后天", at(2026, 9, 11)],
    ["#大后天", at(2026, 9, 12)],
    ["#3天后", at(2026, 9, 12)],
    ["#2周后", at(2026, 9, 23)],
    ["#9月30日", at(2026, 9, 30)],
    ["#9月30号", at(2026, 9, 30)],
    ["#2027年1月5日", at(2027, 1, 5)],
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
    ["#周五", at(2026, 9, 11)],
    ["#周三", at(2026, 9, 9)], // today still counts as "this Wednesday"
    ["#星期一", at(2026, 9, 14)], // this Monday already passed → next one
    ["#礼拜天", at(2026, 9, 13)],
    ["#本周五", at(2026, 9, 11)],
    ["#这周五", at(2026, 9, 11)],
    ["#下周五", at(2026, 9, 18)],
    ["#下下周一", at(2026, 9, 21)],
  ])("reads %s relative to the current week", (text, dueAt) => {
    expect(parse(`写周报 ${text}`)).toEqual({
      title: "写周报",
      projectId: null,
      priority: null,
      dueAt,
    });
  });

  it("accepts the full-width hash a Chinese IME produces", () => {
    expect(parse("写周报 ＃明天").dueAt).toBe(at(2026, 9, 10));
  });

  it("rolls a month/day already past into next year", () => {
    expect(parse("写周报 #9月1日").dueAt).toBe(at(2027, 9, 1));
  });

  it.each([
    ["#明天下午3点", at(2026, 9, 10, 15, 0, 0)],
    ["#明天上午9点15分", at(2026, 9, 10, 9, 15, 0)],
    ["#周五晚上8点半", at(2026, 9, 11, 20, 30, 0)],
    ["#明天中午12点", at(2026, 9, 10, 12, 0, 0)],
  ])("reads %s down to the minute", (text, dueAt) => {
    expect(parse(`写周报 ${text}`)).toEqual({
      title: "写周报",
      projectId: null,
      priority: null,
      dueAt,
    });
  });

  it("takes the first # that actually reads as a date", () => {
    expect(parse("写周报 #不是 #明天")).toEqual({
      title: "写周报 #不是",
      projectId: null,
      priority: null,
      dueAt: at(2026, 9, 10),
    });
  });

  it("leaves a # that reads as nothing alone", () => {
    expect(parse("issue #123 待办")).toEqual(untouched("issue #123 待办"));
    expect(parse("选 C# 还是别的")).toEqual(untouched("选 C# 还是别的"));
  });
});

describe("parseQuickAdd: bare date words are just words now", () => {
  it.each([
    "明天要交的报告",
    "月底前完成报表",
    "周日之前搞定",
    "下周五开会",
    "9月30日截止",
    "完成 3/4 的报表",
  ])("leaves %s completely untouched", (text) => {
    expect(parse(text)).toEqual(untouched(text));
  });

  it("keeps the words in the title and still reads the marked date", () => {
    expect(parse("月底前完成报表 #明天")).toEqual({
      title: "月底前完成报表",
      projectId: null,
      priority: null,
      dueAt: at(2026, 9, 10),
    });
  });
});

describe("parseQuickAdd: numeric dates after #", () => {
  it.each([
    ["#9/30", at(2026, 9, 30)],
    ["#9-30", at(2026, 9, 30)],
    ["#2026-09-30", at(2026, 9, 30)],
    ["#2026/9/30", at(2026, 9, 30)],
    ["#2027-01-05", at(2027, 1, 5)],
  ])("reads %s", (text, dueAt) => {
    expect(parse(`写周报 ${text}`)).toEqual({
      title: "写周报",
      projectId: null,
      priority: null,
      dueAt,
    });
  });

  it("treats a written-out year as literal and a bare one as next year", () => {
    expect(parse("写周报 #9/1").dueAt).toBe(at(2027, 9, 1));
    expect(parse("写周报 #2026-09-01").dueAt).toBe(at(2026, 9, 1));
  });

  it("still takes a time of day on top of one", () => {
    expect(parse("写周报 #9/30下午3点").dueAt).toBe(at(2026, 9, 30, 15, 0, 0));
  });

  it.each([
    "#2/31", // February never has 31 days
    "#2月31日",
    "#13/1", // there is no thirteenth month
    "#0/5",
  ])("refuses %s rather than guessing", (text) => {
    expect(parse(`写周报 ${text}`)).toEqual(untouched(`写周报 ${text}`));
  });

  it("does not read a slash date without the marker", () => {
    expect(parse("完成 3/4 的报表")).toEqual(untouched("完成 3/4 的报表"));
  });
});

describe("parseQuickAdd: month, year and weekend edges", () => {
  it.each([
    // now is Wednesday 2026-09-09
    ["#月底", at(2026, 9, 30)],
    ["#本月底", at(2026, 9, 30)],
    ["#这个月底", at(2026, 9, 30)],
    ["#下月底", at(2026, 10, 31)],
    ["#下个月底", at(2026, 10, 31)],
    ["#下下月底", at(2026, 11, 30)],
  ])("reads %s as the last day of its month", (text, dueAt) => {
    expect(parse(`写周报 ${text}`)).toEqual({
      title: "写周报",
      projectId: null,
      priority: null,
      dueAt,
    });
  });

  it.each([
    ["#月初", at(2026, 10, 1)], // 1 September has gone: the next one
    ["#本月初", at(2026, 9, 1)], // 本 is literal, even though it is behind us
    ["#下月初", at(2026, 10, 1)],
    ["#月中", at(2026, 9, 15)],
    ["#本月中", at(2026, 9, 15)],
    ["#下月中", at(2026, 10, 15)],
  ])("reads %s as the first or middle of its month", (text, dueAt) => {
    expect(parse(`写周报 ${text}`)).toEqual({
      title: "写周报",
      projectId: null,
      priority: null,
      dueAt,
    });
  });

  it.each([
    ["#年底", at(2026, 12, 31)],
    ["#今年底", at(2026, 12, 31)],
    ["#明年底", at(2027, 12, 31)],
    ["#2028年底", at(2028, 12, 31)],
  ])("reads %s as the last day of its year", (text, dueAt) => {
    expect(parse(`写周报 ${text}`)).toEqual({
      title: "写周报",
      projectId: null,
      priority: null,
      dueAt,
    });
  });

  it.each([
    // 2026-09-09 is a Wednesday, so this week's Sunday is the 13th.
    ["#周末", at(2026, 9, 13)],
    ["#这周末", at(2026, 9, 13)],
    ["#这个周末", at(2026, 9, 13)],
    ["#本周末", at(2026, 9, 13)],
    ["#下周末", at(2026, 9, 20)],
    ["#下个周末", at(2026, 9, 20)],
    ["#下下周末", at(2026, 9, 27)],
  ])("reads %s as the Sunday that closes it", (text, dueAt) => {
    expect(parse(`写周报 ${text}`)).toEqual({
      title: "写周报",
      projectId: null,
      priority: null,
      dueAt,
    });
  });

  it("rolls a bare edge forward instead of landing in the past", () => {
    const afterMidMonth = new Date(2026, 8, 25, 10, 0, 0); // 25 September
    expect(parseAt("写周报 #月中", afterMidMonth).dueAt).toBe(at(2026, 10, 15));
    expect(parseAt("写周报 #月初", afterMidMonth).dueAt).toBe(at(2026, 10, 1));
    // 月底 on the last day is still today, not next month's.
    const lastDay = new Date(2026, 8, 30, 10, 0, 0);
    expect(parseAt("写周报 #月底", lastDay).dueAt).toBe(at(2026, 9, 30));
  });

  it("keeps a spelled-out edge on its own period even when it has passed", () => {
    const afterMidMonth = new Date(2026, 8, 25, 10, 0, 0);
    expect(parseAt("写周报 #本月中", afterMidMonth).dueAt).toBe(at(2026, 9, 15));
  });

  it("uses the real length of the month, leap years included", () => {
    const january = new Date(2028, 0, 15, 10, 0, 0); // 2028 is a leap year
    expect(parseAt("写周报 #2月底", january).dueAt).toBe(at(2028, 2, 29));
    expect(parseAt("写周报 #下月底", january).dueAt).toBe(at(2028, 2, 29));
  });

  it("reads an explicit month in the future, or next year once it has passed", () => {
    expect(parse("写周报 #12月底").dueAt).toBe(at(2026, 12, 31));
    expect(parse("写周报 #3月底").dueAt).toBe(at(2027, 3, 31));
    expect(parse("写周报 #3月初").dueAt).toBe(at(2027, 3, 1));
  });

  it("refuses an impossible month rather than guessing one", () => {
    expect(parse("写周报 #13月底")).toEqual(untouched("写周报 #13月底"));
  });

  it("still takes a time of day on top of an edge", () => {
    expect(parse("写周报 #月底下午3点").dueAt).toBe(at(2026, 9, 30, 15, 0, 0));
  });
});

describe("parseQuickAdd: everything at once", () => {
  it("pulls the project, priority and date out of one line", () => {
    expect(parse("写周报 @Work !高 #明天下午3点")).toEqual({
      title: "写周报",
      projectId: "p-work",
      priority: "high",
      dueAt: at(2026, 9, 10, 15, 0, 0),
    });
  });

  it("tidies the whitespace the markers leave behind", () => {
    expect(parse("   写周报   @Work    !高   #明天   ").title).toBe("写周报");
  });

  it("keeps a title that is nothing but markers as an empty title", () => {
    // The caller decides what an empty title means (it refuses to file one).
    expect(parse("@Work !高 #明天").title).toBe("");
  });
});
