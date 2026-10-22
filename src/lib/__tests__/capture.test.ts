import { describe, expect, it } from "vite-plus/test";
import {
  CAPTURE_DEFAULTS,
  parseCapture,
  stepEffort,
  type CaptureContext,
  type CaptureField,
} from "../capture";
import type { CaptureFields } from "../../model/types";

const ctx: CaptureContext = {
  today: "2026-10-21",
  projects: [
    { id: "p1", name: "华东客户交付" },
    { id: "p2", name: "华东" },
    { id: "p3", name: "Alpha" },
    { id: "p4", name: "华东 客户" },
  ],
  people: [
    { id: "u1", name: "老李" },
    { id: "u2", name: "王工" },
    { id: "me", name: "我" },
    { id: "u3", name: "bar" },
  ],
};

function parse(raw: string, base: Partial<CaptureFields> = {}) {
  return parseCapture(raw, ctx, base);
}

function fields(over: Partial<CaptureFields> = {}): CaptureFields {
  return { ...CAPTURE_DEFAULTS, ...over };
}

function due(raw: string): string | null {
  return parse(raw).fields.dueDate;
}

function effort(raw: string): number {
  return parse(raw).fields.effortDays;
}

function priority(raw: string): string {
  return parse(raw).fields.priority;
}

describe("parseCapture", () => {
  it("leaves bare text alone", () => {
    expect(parse("  华东客户交付 老李 周五 高优 2天  ")).toEqual({
      title: "华东客户交付 老李 周五 高优 2天",
      fields: fields(),
      matched: [],
    });
  });

  it("reads all five symbols", () => {
    expect(parse("#华东客户交付 @老李 !P1 ^下周一 ~1.5天 把方案发出去")).toEqual({
      title: "把方案发出去",
      fields: fields({
        projectId: "p1",
        ownerId: "u1",
        priority: "high",
        dueDate: "2026-10-26",
        effortDays: 1.5,
      }),
      matched: ["projectId", "ownerId", "priority", "dueDate", "effortDays"],
    });
  });

  it("reads symbols at the end too", () => {
    const parsed = parse("把方案发出去 #华东客户交付 @老李 !高 ^周五 ~2天");
    expect(parsed.title).toBe("把方案发出去");
    expect(parsed.fields.projectId).toBe("p1");
    expect(parsed.fields.ownerId).toBe("u1");
    expect(parsed.fields.priority).toBe("high");
    expect(parsed.fields.dueDate).toBe("2026-10-23");
    expect(parsed.fields.effortDays).toBe(2);
  });

  it("prefers the longest matching project or person", () => {
    expect(parse("#华东客户交付 做方案").fields.projectId).toBe("p1");
    expect(parse("#华东 做方案").fields.projectId).toBe("p2");
    expect(parse("#华东 客户 做方案").fields.projectId).toBe("p4");
    expect(parse("@王工 做方案").fields.ownerId).toBe("u2");
  });

  it("allows an explicit one-character person", () => {
    const parsed = parse("@我 写周报");
    expect(parsed.fields.ownerId).toBe("me");
    expect(parsed.title).toBe("写周报");
  });

  it("does not treat C# or email addresses as tokens", () => {
    expect(parse("C#华东 做方案").fields.projectId).toBeNull();
    expect(parse("C#华东 做方案").title).toBe("C#华东 做方案");
    expect(parse("mail foo@bar.com").fields.ownerId).toBeNull();
    expect(parse("mail foo@bar.com").title).toBe("mail foo@bar.com");
  });

  it("lets the last valid token win and strips every valid token", () => {
    const parsed = parse("#华东 #华东客户交付 !低 !高 ^明天 ^周五 ~1天 ~2天 发邮件");
    expect(parsed.title).toBe("发邮件");
    expect(parsed.fields.projectId).toBe("p1");
    expect(parsed.fields.priority).toBe("high");
    expect(parsed.fields.dueDate).toBe("2026-10-23");
    expect(parsed.fields.effortDays).toBe(2);
  });

  it("leaves unrecognized tokens in the title", () => {
    const raw = "!foo ^foo ~foo #不存在 @不存在 发邮件";
    expect(parse(raw)).toEqual({
      title: raw,
      fields: fields(),
      matched: [],
    });
  });

  it("keeps invalid dates as text", () => {
    expect(parse("^2/30 交底").fields.dueDate).toBeNull();
    expect(parse("^2/30 交底").title).toBe("^2/30 交底");
    expect(parse("^2026-02-30 交底").fields.dueDate).toBeNull();
  });

  it("strips the optional before/after suffix with the date token", () => {
    expect(parse("^周五前 发邮件").title).toBe("发邮件");
    expect(parse("^周五前 发邮件").fields.dueDate).toBe("2026-10-23");
    expect(parse("^2026-11-20 前 发邮件").title).toBe("发邮件");
  });

  it("uses the base project until a project token overrides it", () => {
    expect(parse("写方案", { projectId: "p2" }).fields.projectId).toBe("p2");
    expect(parse("写方案", { projectId: "p2" }).matched).toEqual([]);
    expect(parse("#华东客户交付 写方案", { projectId: "p2" }).fields.projectId).toBe("p1");
  });

  it("collapses whitespace after removing tokens", () => {
    expect(parse("  发邮件   #华东客户交付   给老李  ").title).toBe("发邮件 给老李");
  });

  it("keeps the raw line when every token was removed", () => {
    expect(parse("@老李 !高").title).toBe("@老李 !高");
  });

  it("orders matched fields consistently", () => {
    const parsed = parse("~2天 @老李 #华东 !高 ^明天 发邮件");
    expect(parsed.matched).toEqual([
      "projectId",
      "ownerId",
      "priority",
      "dueDate",
      "effortDays",
    ] satisfies CaptureField[]);
  });
});

describe("date tokens", () => {
  it("reads relative days", () => {
    expect(due("^今天")).toBe("2026-10-21");
    expect(due("^明日")).toBe("2026-10-22");
    expect(due("^后天")).toBe("2026-10-23");
    expect(due("^大后天")).toBe("2026-10-24");
    expect(due("^3天后")).toBe("2026-10-24");
    expect(due("^3天内")).toBe("2026-10-24");
    expect(due("^3天之后")).toBe("2026-10-24");
  });

  it("reads weekdays against a Monday week start", () => {
    expect(due("^周五")).toBe("2026-10-23");
    expect(due("^周一")).toBe("2026-10-26");
    expect(due("^本周一")).toBe("2026-10-19");
    expect(due("^下周一")).toBe("2026-10-26");
    expect(due("^下周五")).toBe("2026-10-30");
    expect(due("^周天")).toBe("2026-10-25");
    expect(due("^周日")).toBe("2026-10-25");
  });

  it("reads explicit dates with the current year", () => {
    expect(due("^2026-11-20")).toBe("2026-11-20");
    expect(due("^2026/11/20")).toBe("2026-11-20");
    expect(due("^2026年11月20号")).toBe("2026-11-20");
    expect(due("^11月20日")).toBe("2026-11-20");
    expect(due("^11/20")).toBe("2026-11-20");
  });
});

describe("year rollover", () => {
  function parseAt(raw: string, today: string) {
    return parseCapture(raw, { ...ctx, today });
  }

  it("rolls a month/day token into next year when it has passed", () => {
    expect(parseAt("^1/5 发报表", "2026-12-30").fields.dueDate).toBe("2027-01-05");
    expect(parseAt("^1月5日 发报表", "2026-12-30").fields.dueDate).toBe("2027-01-05");
  });

  it("keeps a month/day token in this year when it is still ahead", () => {
    expect(parseAt("^12/31 发报表", "2026-12-30").fields.dueDate).toBe("2026-12-31");
  });

  it("does not invent an invalid date across a leap year", () => {
    const parsed = parseAt("^2/29 发报表", "2027-03-01");
    expect(parsed.fields.dueDate).toBeNull();
    expect(parsed.title).toBe("^2/29 发报表");
  });
});

describe("effort tokens", () => {
  it("reads days and person-days", () => {
    expect(effort("~2天")).toBe(2);
    expect(effort("~1.5天")).toBe(1.5);
    expect(effort("~半天")).toBe(0.5);
    expect(effort("~两天")).toBe(2);
    expect(effort("~2人天")).toBe(2);
    expect(effort("~2人日")).toBe(2);
    expect(effort("~2个工作日")).toBe(2);
    expect(effort("~2")).toBe(2);
    expect(effort("~2d")).toBe(2);
  });

  it("ignores values outside the half-day range", () => {
    expect(effort("~0.25")).toBe(1);
    expect(effort("~61")).toBe(1);
    expect(effort("~0.25天")).toBe(1);
    expect(effort("~2.25天")).toBe(1);
  });
});

describe("stepping effort", () => {
  it("moves on the half-day grid and clamps at both ends", () => {
    expect(stepEffort(1, 1)).toBe(1.5);
    expect(stepEffort(1, -1)).toBe(0.5);
    expect(stepEffort(0.5, -1)).toBe(0.5);
    expect(stepEffort(59.5, 1)).toBe(60);
    expect(stepEffort(60, 1)).toBe(60);
  });

  it("aligns an off-grid value in the direction of travel", () => {
    expect(stepEffort(1.3, 1)).toBe(1.5);
    expect(stepEffort(1.3, -1)).toBe(1);
  });
});

describe("priority tokens", () => {
  it("reads P levels", () => {
    expect(priority("!P0")).toBe("high");
    expect(priority("!p1")).toBe("high");
    expect(priority("!P2")).toBe("normal");
    expect(priority("!p3")).toBe("low");
    expect(priority("!p4")).toBe("low");
    expect(priority("!p10")).toBe("normal");
  });

  it("reads words in both languages", () => {
    expect(priority("!高")).toBe("high");
    expect(priority("!中")).toBe("normal");
    expect(priority("!低")).toBe("low");
    expect(priority("!高优先级")).toBe("high");
    expect(priority("!不急")).toBe("low");
    expect(priority("!urgent")).toBe("high");
    expect(priority("!low priority")).toBe("low");
    expect(priority("!normal priority")).toBe("normal");
  });
});
